<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import Autocomplete from '$lib/components/primitives/Autocomplete.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { rules } from '$lib/stores/rules.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import { formatCurrency } from '$lib/utils/currency';
	import { onMount } from 'svelte';
	import type { Transaction, TransactionKind } from '$lib/db/repos/transactions';
	import * as m from '$lib/paraglide/messages';
	import { mapError } from '$lib/utils/errors';

	let { mode = 'full', existing = null, onclose = () => {}, onsave = () => {} }: {
		mode?: 'full' | 'quick';
		existing?: Transaction | null;
		onclose?: () => void;
		onsave?: () => void;
	} = $props();

	const isEdit = $derived(existing !== null);

	let kind = $state<TransactionKind>(existing?.kind ?? 'expense');
	let amount = $state(existing ? String(existing.amount) : '');
	let tagId = $state(existing?.tag_id ?? '');
	let accountId = $state(existing?.account_id ?? '');
	let payee = $state(existing?.payee ?? '');
	let date = $state(existing?.date ?? new Date().toISOString().split('T')[0]);
	let description = $state(existing?.description ?? '');
	let transferAccountId = $state(existing?.transfer_account_id ?? '');
	let saving = $state(false);
	let error = $state('');
	let amountError = $state('');
	let accountError = $state('');
	let transferError = $state('');
	let showAdvancedKinds = $state(false);

	// Field-level validation errors clear themselves once the offending field
	// changes from the value that failed. Snapshots record what each field
	// held when the error was raised; `error` above stays reserved for
	// failures returned by the persistence layer.
	let amountAtError = '';
	let accountAtError = '';
	let transferAtError = '';

	function flagField(field: 'amount' | 'account' | 'transfer', message: string) {
		if (field === 'amount') { amountError = message; amountAtError = amount; }
		if (field === 'account') { accountError = message; accountAtError = accountId; }
		if (field === 'transfer') { transferError = message; transferAtError = transferAccountId; }
	}

	$effect(() => {
		if (amountError && amount !== amountAtError) amountError = '';
		if (accountError && accountId !== accountAtError) accountError = '';
		if (transferError && transferAccountId !== transferAtError) transferError = '';
	});

	let suggestedTag = $derived(rules.matchTag(payee));

	$effect(() => {
		if (suggestedTag && !tagId) {
			tagId = suggestedTag;
		}
	});

	const DRAFT_KEY = 'notchy_tx_draft';

	onMount(async () => {
		await accounts.load();
		await categories.load();

		// Only restore draft if not editing
		if (!isEdit) {
			const draft = sessionStorage.getItem(DRAFT_KEY);
			if (draft) {
				try {
					const d = JSON.parse(draft);
					kind = d.kind ?? kind; amount = d.amount ?? ''; tagId = d.tagId ?? '';
					payee = d.payee ?? ''; description = d.description ?? '';
				} catch {}
			}
			accountId = session.lastUsedAccountId ?? accounts.items[0]?.id ?? '';
			date = session.lastEnteredDate ?? new Date().toISOString().split('T')[0];
		}
	});

	$effect(() => {
		if (!isEdit) {
			sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, amount, tagId, payee, description }));
		}
	});

	const kinds = [
		{ value: 'expense', label: m.forms_expense() },
		{ value: 'income', label: m.forms_income() },
		{ value: 'transfer', label: m.forms_transfer() },
		{ value: 'refund', label: m.forms_refund() },
		{ value: 'adjustment', label: m.forms_adjustment() }
	];

	const primaryKinds = kinds.filter((k) => k.value === 'expense' || k.value === 'income');
	const advancedKinds = kinds.filter((k) => k.value !== 'expense' && k.value !== 'income');

	let accountOptions = $derived(accounts.items.map((a) => ({ value: a.id, label: a.name })));
	let tagOptions = $derived(categories.tags.map((t) => ({ value: t.id, label: t.name })));
	let payeeOptions = $derived(
		[...new Set(transactions.items.filter((t) => t.payee).map((t) => t.payee!))]
			.slice(0, 20)
			.map((p) => ({ value: p, label: p }))
	);

	async function save() {
		if (saving) return;
		error = '';
		amountError = '';
		accountError = '';
		transferError = '';
		let parsedAmount: number;
		try {
			parsedAmount = parseAmount(amount, settings.locale, settings.currency);
		} catch {
			flagField('amount', m.validation_invalid_amount());
			return;
		}
		if (!accountId) { flagField('account', m.forms_select_account()); return; }
		if (kind === 'transfer' && !transferAccountId) { flagField('transfer', m.forms_select_destination()); return; }
		if (kind === 'transfer' && transferAccountId === accountId) { flagField('transfer', m.validation_source_dest_differ()); return; }

		saving = true;
		try {
			if (isEdit) {
				// existing is guaranteed non-null when isEdit is true (isEdit = existing !== null)
				await transactions.update(existing!.id, {
					date,
					amount: parsedAmount,
					tag_id: kind !== 'transfer' ? (tagId || null) : null,
					payee: payee || null,
					description: description || null
				});
				toast.show(m.forms_transaction_updated());
			} else {
				await transactions.create({
					kind,
					date,
					amount: parsedAmount,
					account_id: accountId,
					transfer_account_id: kind === 'transfer' ? transferAccountId : undefined,
					tag_id: kind !== 'transfer' ? (tagId || undefined) : undefined,
					payee: payee || undefined,
					description: description || undefined
				});

				// Learn rule from this transaction (fire-and-forget)
				if (payee && tagId && kind !== 'transfer') {
					rules.learnRule(payee, tagId).catch(() => {
						// Learning failure is non-fatal; logged in learnRule
					});
				}

				session.lastUsedAccountId = accountId;
				session.lastEnteredDate = date;
				toast.show(m.forms_saved({ kind, amount: formatCurrency(parsedAmount, settings.currency, settings.locale) }));
				sessionStorage.removeItem(DRAFT_KEY);
				amount = '';
				tagId = '';
				payee = '';
				description = '';
			}
			onsave();
			if (mode === 'full') onclose();
		} catch (e) {
			error = mapError(e);
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4">
	{#if error}
		<p class="text-sm text-debit">{error}</p>
	{/if}

		<!-- AMOUNT: primary input, autofocus -->
	<Input label={m.common_amount()} bind:value={amount} placeholder={m.forms_amount_placeholder()} error={amountError} autofocus />

	<!-- KIND: secondary toggle with progressive disclosure -->
	<div class="space-y-2" role="group" aria-label={m.forms_kind_group()}>
		<div class="flex flex-wrap gap-2">
			{#each primaryKinds as k}
				<button onclick={() => kind = k.value as TransactionKind} disabled={isEdit}
					aria-pressed={kind === k.value}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'} {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
				>{k.label}</button>
			{/each}
			{#if advancedKinds.some((k) => !showAdvancedKinds || kind !== k.value)}
				<button onclick={() => showAdvancedKinds = !showAdvancedKinds} disabled={isEdit}
					aria-expanded={showAdvancedKinds}
					class="px-3 py-1.5 text-xs text-dim hover:text-ledger transition-colors {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
				>{m.forms_more_kinds()}</button>
			{/if}
		</div>
		{#if showAdvancedKinds}
			<div class="flex flex-wrap gap-2 pt-1 border-t border-line/50">
				{#each advancedKinds as k}
					<button onclick={() => kind = k.value as TransactionKind} disabled={isEdit}
						aria-pressed={kind === k.value}
						class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'} {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
					>{k.label}</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ACCOUNT/TAG -->
	{#if kind === 'transfer'}
		<Select label={m.forms_from_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} error={accountError} />
		<Select label={m.forms_to_account()} bind:value={transferAccountId} options={accountOptions} disabled={isEdit} error={transferError} />
	{:else}
		<Select label={m.forms_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} error={accountError} />
		<Autocomplete label={m.forms_tag()} bind:value={tagId} options={tagOptions} placeholder={m.forms_search_tags_placeholder()} />
		{#if suggestedTag && tagId === suggestedTag}
			<span class="text-xs text-dim mt-1">{m.forms_tag_auto()}</span>
		{/if}
	{/if}

	<!-- PAYEE + DATE/DESCRIPTION (full mode only) -->
	{#if mode === 'full'}
		<Autocomplete label={m.forms_payee()} bind:value={payee} options={payeeOptions} allowFreeText={true} placeholder={m.forms_who_paid()} />
		<div class="grid grid-cols-2 gap-3">
			<Input label={m.common_date()} type="date" bind:value={date} />
			<Input label={m.common_description()} bind:value={description} placeholder={m.common_optional()} maxlength={1024} />
		</div>
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>{m.common_cancel()}</Button>
		<Button disabled={saving || !amount} onclick={save}>{saving ? m.forms_saving() : (isEdit ? m.forms_save_changes() : m.common_save())}</Button>
	</div>
</div>
