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
	import { labelFor } from '$lib/utils/tx-kind';
	import type { AccountWithBalance, AccountType } from '$lib/db/repos/accounts';
	import type { Transaction } from '$lib/db/repos/transactions';
	import type { Reconciliation } from '$lib/db/repos/reconciliations';
	import * as m from '$lib/paraglide/messages';

	let account = $state<AccountWithBalance | null>(null);
	let txns = $state<Transaction[]>([]);
	let history = $state<Reconciliation[]>([]);
	let showReconcile = $state(false);
	let actualBalance = $state('');
	let confirmLarge = $state(false);
	let pendingDiscrepancy = $state(0);

	const accountId = $derived($page.params.id);

	function accountTypeLabel(type: AccountType): string {
		switch (type) {
			case 'checking': return m.forms_account_type_checking();
			case 'savings': return m.forms_account_type_savings();
			case 'cash': return m.forms_account_type_cash();
			case 'credit_card': return m.forms_account_type_credit_card();
			case 'loan_to_person': return m.forms_account_type_loan_to_person();
			case 'loan_from_person': return m.forms_account_type_loan_from_person();
			default: return type;
		}
	}

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
			toast.show(m.accounts_invalid_amount());
		}
	}

	async function doReconcile(actual: number) {
		const db = await getDb();
		const result = await reconcile(db, accountId, actual, true);
		toast.show(result.discrepancy === 0 ? m.accounts_reconciled_toast() : m.accounts_adjustment_created({ amount: formatCurrency(result.discrepancy, settings.currency, settings.locale) }));
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
				<h1 class="figures text-xl text-ledger tracking-wide">{account.name}</h1>
				<p class="text-sm text-dim">{accountTypeLabel(account.type)}{account.counterparty ? ` · ${account.counterparty}` : ''}</p>
			</div>
			<Button size="sm" variant="secondary" onclick={() => { showReconcile = true; actualBalance = String(account!.balance); }}>{m.accounts_reconcile()}</Button>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4">
			<p class="figures text-2xl text-ledger">{formatCurrency(account.balance, settings.currency, settings.locale)}</p>
			<p class="plate mt-1">{m.accounts_current_balance()}</p>
		</div>

		<section>
			<h2 class="plate mb-2">{m.accounts_transactions()}</h2>
			{#if txns.length === 0}
				<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
					<p class="text-sm">{m.accounts_no_transactions()}</p>
				</div>
			{:else}
				<div class="bg-tape rounded-lg border border-line divide-y divide-line">
					{#each txns as tx}
						<div class="p-3 flex items-center justify-between text-sm">
							<div>
								<div class="text-ledger">{tx.payee || labelFor(tx.kind)}</div>
								<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)}</div>
							</div>
							<span class="figures {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
								{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if history.length > 0}
			<section>
				<h2 class="plate mb-2">{m.accounts_reconciliation_history()}</h2>
				<div class="bg-tape rounded-lg border border-line divide-y divide-line">
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
		<p class="text-dim">{m.accounts_loading()}</p>
	{/if}
</div>

<Modal bind:open={showReconcile} title={m.accounts_reconcile_modal()}>
	<div class="space-y-4">
		<p class="text-sm text-dim">{m.accounts_reconcile_body()}</p>
		<Input label={m.accounts_actual_balance_label()} bind:value={actualBalance} placeholder={m.accounts_amount_placeholder()} />
		{#if account}
			<p class="text-xs text-dim">{m.accounts_currently_shown({ balance: formatCurrency(account.balance, settings.currency, settings.locale) })}</p>
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => showReconcile = false}>{m.common_cancel()}</Button>
			<Button onclick={startReconcile}>{m.accounts_reconcile()}</Button>
		</div>
	</div>
</Modal>

<ConfirmDialog
	open={confirmLarge}
	title={m.accounts_large_discrepancy_title()}
	message={m.accounts_large_discrepancy_body({ amount: formatCurrency(pendingDiscrepancy, settings.currency, settings.locale) })}
	confirmLabel={m.accounts_yes_reconcile()}
	danger={false}
	onconfirm={confirmLargeReconcile}
/>
