<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { getDb } from '$lib/db';
	import { isLargeDiscrepancy } from '$lib/db/repos/reconciliations';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import Money from '$lib/components/reports/Money.svelte';
	import { formatDateRelative } from '$lib/utils/date';
	import { parseAmount } from '$lib/utils/number_parse';
	import { labelFor } from '$lib/utils/tx-kind';
	import { accountTypeLabel } from '$lib/utils/account-type';
	import { mapError } from '$lib/utils/errors';
	import type { AccountWithBalance, Transaction, Reconciliation } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	let account = $state<AccountWithBalance | null>(null);
	let txns = $state<Transaction[]>([]);
	let history = $state<Reconciliation[]>([]);
	// A missing or failed load must surface, never hang as a skeleton.
	let notFound = $state(false);
	let errorMsg = $state<string | null>(null);
	let showReconcile = $state(false);
	let actualBalance = $state('');
	let reconcileError = $state('');
	let confirmLarge = $state(false);
	let pendingDiscrepancy = $state(0);
	let pendingActual = $state(0);

	const accountId = $derived($page.params.id);

	async function load() {
		errorMsg = null;
		notFound = false;
		try {
			const db = getDb();
			account = await db.accounts.get(accountId);
			if (!account) {
				notFound = true;
				return;
			}
			txns = await db.transactions.list({ account_id: accountId, limit: 100 });
			history = await db.reconciliations.getHistory(accountId);
		} catch (e) {
			errorMsg = mapError(e);
		}
	}

	onMount(load);

	// Re-load when the id param changes (in-app nav between accounts).
	$effect(() => {
		accountId;
		void load();
	});

	async function startReconcile() {
		if (!actualBalance.trim()) return;
		try {
			const parsed = parseAmount(actualBalance, settings.locale, settings.currency);
			reconcileError = '';
			const expected = account!.balance;
			const discrepancy = parsed - expected;
			if (isLargeDiscrepancy(discrepancy)) {
				pendingDiscrepancy = discrepancy;
				// Restate the entered figure through the same formatter the rest
				// of the ledger speaks — never the raw input string.
				pendingActual = parsed;
				confirmLarge = true;
				return;
			}
			await doReconcile(parsed);
		} catch {
			// Field-level: the problem lives next to the input, not in a toast.
			reconcileError = m.accounts_invalid_amount();
		}
	}

	async function doReconcile(actual: number) {
		try {
			const db = getDb();
			const result = await db.reconciliations.reconcile(accountId, actual, true);
			toast.show(result.discrepancy === 0 ? m.accounts_reconciled_toast() : m.accounts_adjustment_created({ amount: formatCurrency(result.discrepancy, settings.currency, settings.locale) }));
			showReconcile = false;
			actualBalance = '';
			await load();
		} catch (e) {
			toast.show(mapError(e));
		}
	}

	async function confirmLargeReconcile() {
		const parsed = parseAmount(actualBalance, settings.locale, settings.currency);
		await doReconcile(parsed);
		confirmLarge = false;
	}
</script>

<div class="space-y-6">
	<a href="/accounts" class="inline-flex items-center gap-1 text-xs text-dim hover:text-phosphor transition-colors">← {m.common_back()}</a>

	{#if errorMsg}
		<ErrorState description={errorMsg} onRetry={load} />
	{:else if notFound}
		<div class="surface rounded-lg p-6 text-center text-dim">
			<p class="text-sm">{m.errors_account_not_found()}</p>
		</div>
	{:else if account}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="page-title">{account.name}</h1>
				<p class="text-sm text-dim">{accountTypeLabel(account.type)}{account.counterparty ? ` · ${account.counterparty}` : ''}</p>
			</div>
			<Button size="sm" variant="secondary" onclick={() => { showReconcile = true; actualBalance = ''; reconcileError = ''; }}>{m.accounts_reconcile()}</Button>
		</div>

		<div class="surface rounded-lg p-4">
			<p class="figures text-2xl text-ledger">{formatCurrency(account.balance, settings.currency, settings.locale)}</p>
			<p class="plate mt-1">{m.accounts_current_balance()}</p>
		</div>

		<section>
			<h2 class="plate mb-2">{m.accounts_transactions()}</h2>
			{#if txns.length === 0}
				<div class="surface rounded-lg p-6 text-center text-dim">
					<p class="text-sm">{m.accounts_no_transactions()}</p>
				</div>
			{:else}
				<div class="surface rounded-lg divide-y divide-line">
					{#each txns as tx}
						<!-- Same contract as every other transaction row: tap opens
						     the record. -->
						<div class="p-3 text-sm">
							<a href={`/transactions/${tx.id}`} class="flex items-center justify-between">
								<div>
									<div class="text-ledger">{tx.payee || labelFor(tx.kind)}</div>
									<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)}</div>
								</div>
								<Money amount={tx.amount} glyph={tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : ''} tone={tx.kind === 'expense' ? 'debit' : tx.kind === 'income' ? 'phosphor' : 'dim'} />
							</a>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if history.length > 0}
			<section>
				<h2 class="plate mb-2">{m.accounts_reconciliation_history()}</h2>
				<div class="surface rounded-lg divide-y divide-line">
					{#each history as h}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-ledger">{h.date}</div>
								<div class="text-xs text-dim">{m.accounts_expected()} {formatCurrency(h.expected_balance, settings.currency, settings.locale)} · {m.accounts_actual()} {formatCurrency(h.actual_balance, settings.currency, settings.locale)}</div>
							</div>
							<span class="figures text-xs text-phosphor">
								Δ {formatCurrency(h.actual_balance - h.expected_balance, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{:else}
		<div class="surface rounded-lg p-4">
			<Skeleton lines={4} />
		</div>
	{/if}
</div>

<Modal bind:open={showReconcile} title={m.accounts_reconcile_modal()}>
	<div class="space-y-4">
		<p class="text-sm text-dim">{m.accounts_reconcile_body()}</p>
		<Input label={m.accounts_actual_balance_label()} bind:value={actualBalance} placeholder={m.accounts_amount_placeholder()} error={reconcileError} />
		{#if account}
			<p class="text-xs text-dim">{m.accounts_currently_shown({ balance: formatCurrency(account.balance, settings.currency, settings.locale) })}</p>
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => { showReconcile = false; reconcileError = ''; }}>{m.common_cancel()}</Button>
			<Button onclick={startReconcile}>{m.accounts_reconcile()}</Button>
		</div>
	</div>
</Modal>

<ConfirmDialog
	open={confirmLarge}
	title={m.accounts_large_discrepancy_title()}
	message={m.accounts_large_discrepancy_body({
		amount: formatCurrency(pendingDiscrepancy, settings.currency, settings.locale),
		expected: formatCurrency(account?.balance ?? 0, settings.currency, settings.locale),
		actual: formatCurrency(pendingActual, settings.currency, settings.locale)
	})}
	confirmLabel={m.accounts_yes_reconcile()}
	danger={false}
	onconfirm={confirmLargeReconcile}
/>
