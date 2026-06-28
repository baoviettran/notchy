<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { getDb } from '$lib/db';
	import { getAccount } from '$lib/db/repos/accounts';
	import { listTransactions } from '$lib/db/repos/transactions';
	import { reconcile, getReconciliationHistory, isLargeDiscrepancy } from '$lib/db/repos/reconciliations';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { AccountWithBalance } from '$lib/db/repos/accounts';
	import type { Transaction } from '$lib/db/repos/transactions';
	import type { Reconciliation } from '$lib/db/repos/reconciliations';

	let account = $state<AccountWithBalance | null>(null);
	let txns = $state<Transaction[]>([]);
	let history = $state<Reconciliation[]>([]);
	let showReconcile = $state(false);
	let actualBalance = $state('');
	let confirmLarge = $state(false);
	let pendingDiscrepancy = $state(0);

	const accountId = $derived($page.params.id);

	async function load() {
		const db = await getDb();
		account = await getAccount(db, accountId);
		txns = await listTransactions(db, { account_id: accountId, limit: 100 });
		history = await getReconciliationHistory(db, accountId);
	}

	onMount(load);

	async function startReconcile() {
		if (!actualBalance.trim()) return;
		try {
			const parsed = parseAmount(actualBalance, settings.locale, settings.currency);
			const expected = account!.balance;
			const discrepancy = parsed - expected;
			if (isLargeDiscrepancy(discrepancy)) {
				pendingDiscrepancy = discrepancy;
				confirmLarge = true;
				return;
			}
			await doReconcile(parsed);
		} catch {
			toast.show('Invalid amount.');
		}
	}

	async function doReconcile(actual: number) {
		const db = await getDb();
		const result = await reconcile(db, accountId, actual, true);
		toast.show(result.discrepancy === 0 ? 'Account reconciled.' : `Adjustment created (${formatCurrency(result.discrepancy, settings.currency, settings.locale)}).`);
		showReconcile = false;
		actualBalance = '';
		await load();
	}

	async function confirmLargeReconcile() {
		const parsed = parseAmount(actualBalance, settings.locale, settings.currency);
		await doReconcile(parsed);
		confirmLarge = false;
	}
</script>

<div class="space-y-6">
	{#if account}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{account.name}</h1>
				<p class="text-sm text-zinc-500">{account.type}{account.counterparty ? ` · ${account.counterparty}` : ''}</p>
			</div>
			<Button size="sm" variant="secondary" onclick={() => { showReconcile = true; actualBalance = String(account!.balance); }}>Reconcile</Button>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<p class="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(account.balance, settings.currency, settings.locale)}</p>
			<p class="text-sm text-zinc-500">Current balance</p>
		</div>

		<section>
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Transactions</h2>
			{#if txns.length === 0}
				<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
					<p class="text-sm">No transactions for this account.</p>
				</div>
			{:else}
				<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
					{#each txns as tx}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-zinc-900 dark:text-zinc-50">{tx.payee || tx.kind}</div>
								<div class="text-xs text-zinc-500">{formatDateRelative(tx.date, settings.locale)}</div>
							</div>
							<span class="tabular-nums {tx.kind === 'expense' ? 'text-red-500' : tx.kind === 'income' ? 'text-emerald-500' : 'text-zinc-500'}">
								{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if history.length > 0}
			<section>
				<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Reconciliation History</h2>
				<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
					{#each history as h}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-zinc-900 dark:text-zinc-50">{h.date}</div>
								<div class="text-xs text-zinc-500">Expected {formatCurrency(h.expected_balance, settings.currency, settings.locale)} · Actual {formatCurrency(h.actual_balance, settings.currency, settings.locale)}</div>
							</div>
							<span class="text-xs tabular-nums {h.actual_balance - h.expected_balance === 0 ? 'text-emerald-600' : 'text-amber-600'}">
								Δ {formatCurrency(h.actual_balance - h.expected_balance, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{:else}
		<p class="text-zinc-500">Loading...</p>
	{/if}
</div>

<Modal bind:open={showReconcile} title="Reconcile account">
	<div class="space-y-4">
		<p class="text-sm text-zinc-500">Enter the actual balance from your bank statement or wallet. We'll create an adjustment if there's a discrepancy.</p>
		<Input label="Actual balance" bind:value={actualBalance} placeholder="e.g. 5000000" />
		{#if account}
			<p class="text-xs text-zinc-400">Currently shown: {formatCurrency(account.balance, settings.currency, settings.locale)}</p>
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => showReconcile = false}>Cancel</Button>
			<Button onclick={startReconcile}>Reconcile</Button>
		</div>
	</div>
</Modal>

<ConfirmDialog
	open={confirmLarge}
	title="Large discrepancy detected"
	message={`The discrepancy is ${formatCurrency(pendingDiscrepancy, settings.currency, settings.locale)}, which is unusually large. Are you sure?`}
	confirmLabel="Yes, reconcile"
	danger={false}
	onconfirm={confirmLargeReconcile}
/>
