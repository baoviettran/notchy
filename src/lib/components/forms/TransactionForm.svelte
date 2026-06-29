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
	import { parseAmount } from '$lib/utils/number_parse';
	import { formatCurrency } from '$lib/utils/currency';
	import { onMount } from 'svelte';
	import type { Transaction, TransactionKind } from '$lib/db/repos/transactions';
	import * as m from '$lib/paraglide/messages';

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
		let parsedAmount: number;
		try {
			parsedAmount = parseAmount(amount, settings.locale, settings.currency);
		} catch {
			error = m.validation_invalid_amount();
			return;
		}
		if (!accountId) { error = m.forms_select_account(); return; }
		if (kind === 'transfer' && !transferAccountId) { error = m.forms_select_destination(); return; }
		if (kind === 'transfer' && transferAccountId === accountId) { error = m.validation_source_dest_differ(); return; }

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
			error = String(e).replace('Error: ', '');
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4">
	{#if error}
		<p class="text-sm text-debit">{error}</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#each kinds as k}
			<button onclick={() => kind = k.value as TransactionKind} disabled={isEdit}
				class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-phosphor bg-phosphor/10 text-phosphor-bright font-medium' : 'border-line text-dim hover:text-ledger'} {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
			>{k.label}</button>
		{/each}
	</div>

	<Input label={m.common_amount()} bind:value={amount} placeholder={m.forms_amount_placeholder()} />

	{#if kind === 'transfer'}
		<Select label={m.forms_from_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} />
		<Select label={m.forms_to_account()} bind:value={transferAccountId} options={accountOptions} disabled={isEdit} />
	{:else}
		<Autocomplete label={m.forms_tag()} bind:value={tagId} options={tagOptions} placeholder={m.forms_search_tags_placeholder()} />
		<Select label={m.forms_account()} bind:value={accountId} options={accountOptions} disabled={isEdit} />
	{/if}

	{#if mode === 'full'}
		<Autocomplete label={m.forms_payee()} bind:value={payee} options={payeeOptions} placeholder={m.forms_who_paid()} />
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
