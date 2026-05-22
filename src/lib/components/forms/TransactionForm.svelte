<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import { formatCurrency } from '$lib/utils/currency';
	import { onMount } from 'svelte';

	let { mode = 'full', onclose = () => {}, onsave = () => {} }: { mode?: 'full' | 'quick'; onclose?: () => void; onsave?: () => void } = $props();

	let kind = $state('expense');
	let amount = $state('');
	let tagId = $state('');
	let accountId = $state('');
	let payee = $state('');
	let date = $state(new Date().toISOString().split('T')[0]);
	let description = $state('');
	let transferAccountId = $state('');
	let saving = $state(false);
	let error = $state('');

	const DRAFT_KEY = 'notchy_tx_draft';

	// Restore draft on mount
	onMount(async () => {
		await accounts.load();
		await categories.load();
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
	});

	// Auto-save draft
	$effect(() => {
		sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, amount, tagId, payee, description }));
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

		saving = true;
		try {
			await transactions.create({
				kind: kind as any,
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
			onsave();
			if (mode === 'full') onclose();
		} catch (e) {
			error = String(e);
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
			<button onclick={() => kind = k.value}
				class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
			>{k.label}</button>
		{/each}
	</div>

	<Input label="Amount" bind:value={amount} placeholder="e.g. 50k, 1.5tr, 100+50" />

	{#if kind === 'transfer'}
		<Select label="From Account" bind:value={accountId} options={accountOptions} />
		<Select label="To Account" bind:value={transferAccountId} options={accountOptions} />
	{:else}
		<Select label="Tag" bind:value={tagId} options={tagOptions} />
		<Select label="Account" bind:value={accountId} options={accountOptions} />
	{/if}

	{#if mode === 'full'}
		<Input label="Payee" bind:value={payee} placeholder="Who did you pay?" />
		<div class="grid grid-cols-2 gap-3">
			<Input label="Date" type="date" bind:value={date} />
			<Input label="Description" bind:value={description} placeholder="Optional" />
		</div>
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		<Button disabled={saving || !amount} onclick={save}>{saving ? 'Saving...' : 'Save'}</Button>
	</div>
</div>
