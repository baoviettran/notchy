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
		{ value: 'expense', label: 'Expense' },
		{ value: 'income', label: 'Income' },
		{ value: 'transfer', label: 'Transfer' },
		{ value: 'refund', label: 'Refund' },
		{ value: 'adjustment', label: 'Adjustment' }
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
			parsedAmount = parseAmount(amount, settings.locale);
		} catch {
			error = 'Invalid amount';
			return;
		}
		if (!accountId) { error = 'Select an account'; return; }
		if (kind === 'transfer' && !transferAccountId) { error = 'Select a destination account'; return; }
		if (kind === 'transfer' && transferAccountId === accountId) { error = 'Source and destination must differ'; return; }

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
				toast.show('Transaction updated.');
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
				toast.show(`Saved · ${kind} · ${formatCurrency(parsedAmount, settings.currency, settings.locale)}`);
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
		<p class="text-sm text-red-500">{error}</p>
	{/if}

	<div class="flex flex-wrap gap-2">
		{#each kinds as k}
			<button onclick={() => kind = k.value as TransactionKind} disabled={isEdit}
				class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'} {isEdit ? 'cursor-not-allowed opacity-60' : ''}"
			>{k.label}</button>
		{/each}
	</div>

	<Input label="Amount" bind:value={amount} placeholder="e.g. 50k, 1.5tr, 100+50" />

	{#if kind === 'transfer'}
		<Select label="From Account" bind:value={accountId} options={accountOptions} disabled={isEdit} />
		<Select label="To Account" bind:value={transferAccountId} options={accountOptions} disabled={isEdit} />
	{:else}
		<Autocomplete label="Tag" bind:value={tagId} options={tagOptions} placeholder="Search tags..." />
		<Select label="Account" bind:value={accountId} options={accountOptions} disabled={isEdit} />
	{/if}

	{#if mode === 'full'}
		<Autocomplete label="Payee" bind:value={payee} options={payeeOptions} placeholder="Who did you pay?" />
		<div class="grid grid-cols-2 gap-3">
			<Input label="Date" type="date" bind:value={date} />
			<Input label="Description" bind:value={description} placeholder="Optional" maxlength={1024} />
		</div>
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		<Button disabled={saving || !amount} onclick={save}>{saving ? 'Saving...' : (isEdit ? 'Save changes' : 'Save')}</Button>
	</div>
</div>
