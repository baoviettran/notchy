<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import Money from '$lib/components/reports/Money.svelte';
	import { getDb } from '$lib/db';
	import { mapError } from '$lib/utils/errors';
	import { transactions as txStore } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import type { Transaction } from '$lib/db/repos/transactions';
	import * as m from '$lib/paraglide/messages';

	let tx = $state<Transaction | null>(null);
	let accountName = $state('');
	let transferName = $state<string | null>(null);
	let tagName = $state<string | null>(null);
	let notFound = $state(false);
	// A failed load must surface as a retryable error, never an endless skeleton.
	let errorMsg = $state<string | null>(null);
	let showEdit = $state(false);
	let showDeleteConfirm = $state(false);

	const txId = $derived($page.params.id);
	const today = new Date().toISOString().split('T')[0];

	async function load() {
		errorMsg = null;
		notFound = false;
		try {
			const db = getDb();
			const row = await db.transactions.get(txId);
			if (!row) {
				notFound = true;
				return;
			}
			tx = row;
			accountName = (await db.accounts.get(row.account_id))?.name ?? '';
			if (row.transfer_account_id) {
				transferName = (await db.accounts.get(row.transfer_account_id))?.name ?? null;
			}
			if (row.tag_id) {
				tagName = (await db.categories.listTags()).find((t) => t.id === row.tag_id)?.name ?? null;
			}
		} catch (e) {
			errorMsg = mapError(e);
		}
	}

	// Re-load when the id param changes (in-app nav between transactions).
	$effect(() => {
		txId;
		void load();
	});

	async function doDuplicate() {
		if (!tx) return;
		// Land on the copy, like the list's flash-on-duplicate: the toast alone
		// leaves the user wondering where the duplicate went.
		const newId = await txStore.duplicate(tx.id);
		toast.show(m.transactions_duplicated());
		goto(`/transactions/${newId}`);
	}

	function confirmDelete() {
		showDeleteConfirm = true;
	}

	async function doDelete() {
		if (!tx) return;
		await txStore.delete(tx.id);
		toast.show(m.transactions_deleted_toast());
		goto('/transactions');
	}

	const glyph = $derived(
		tx?.kind === 'expense' ? '−' : tx?.kind === 'income' ? '+' : ''
	);
	const tone = $derived(
		tx?.kind === 'expense' ? 'debit' : tx?.kind === 'income' ? 'phosphor' : 'dim'
	);
</script>

<div class="space-y-6">
	<a href="/transactions" class="inline-flex items-center gap-1 text-xs text-dim hover:text-phosphor transition-colors">← {m.common_back()}</a>

	{#if errorMsg}
		<ErrorState description={errorMsg} onRetry={load} />
	{:else if notFound}
		<div class="surface rounded-lg p-6 text-center text-dim">
			<p class="text-sm">{m.tx_detail_not_found()}</p>
		</div>
	{:else if tx}
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h1 class="page-title truncate">{tx.payee || labelFor(tx.kind)}</h1>
				<p class="text-sm text-dim">{labelFor(tx.kind)}</p>
			</div>
			{#if tx.date > today}
				<span class="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">{m.transactions_future()}</span>
			{/if}
		</div>

		<!-- The figure, at statement size: same glyph-paired tone rules the
		     ledger rows obey. -->
		<div class="surface rounded-lg p-4">
			<Money amount={tx.amount} {glyph} {tone} size="text-2xl" />
		</div>

		<section>
			<h2 class="plate mb-2">{m.tx_detail_recorded()}</h2>
			<div class="surface rounded-lg divide-y divide-line text-sm">
				<div class="p-3 flex items-center justify-between">
					<span class="text-dim">{m.common_date()}</span>
					<span class="text-ledger">{formatDateRelative(tx.date, settings.locale)} · {tx.date}</span>
				</div>
				<div class="p-3 flex items-center justify-between">
					<span class="text-dim">{m.forms_account()}</span>
					<span class="text-ledger">{accountName}</span>
				</div>
				{#if transferName}
					<div class="p-3 flex items-center justify-between">
						<span class="text-dim">{m.forms_to_account()}</span>
						<span class="text-ledger">{transferName}</span>
					</div>
				{/if}
				{#if tagName}
					<div class="p-3 flex items-center justify-between">
						<span class="text-dim">{m.forms_tag()}</span>
						<span class="text-ledger">{tagName}</span>
					</div>
				{/if}
				{#if tx.description}
					<div class="p-3 flex items-start justify-between gap-4">
						<span class="text-dim shrink-0">{m.common_description()}</span>
						<span class="text-ledger text-right">{tx.description}</span>
					</div>
				{/if}
			</div>
		</section>

		<div class="flex items-center gap-2">
			<Button size="sm" variant="secondary" onclick={() => (showEdit = true)}>{m.common_edit()}</Button>
			<Button size="sm" variant="secondary" onclick={doDuplicate}>{m.transactions_duplicate()}</Button>
			<Button size="sm" variant="danger" onclick={confirmDelete}>{m.common_delete()}</Button>
		</div>
	{:else}
		<div class="surface rounded-lg p-4">
			<Skeleton lines={5} />
		</div>
	{/if}
</div>

<Modal bind:open={showEdit} title={m.transactions_edit()}>
	<TransactionForm existing={tx} onclose={() => (showEdit = false)} onsave={load} />
</Modal>

<ConfirmDialog
	open={showDeleteConfirm}
	title={m.transactions_delete_confirm_title()}
	message={tx
		? m.transactions_delete_confirm_body() + '\n' + m.transactions_delete_confirm_detail({
				payee: tx.payee || labelFor(tx.kind),
				amount: formatCurrency(tx.amount, settings.currency, settings.locale),
				date: formatDateRelative(tx.date, settings.locale)
			})
		: m.transactions_delete_confirm_body()}
	confirmLabel={m.common_delete()}
	danger={true}
	onconfirm={doDelete}
/>
