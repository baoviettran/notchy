<script lang="ts">
	import { onMount } from 'svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import { page } from '$app/stores';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import type { Transaction } from '$lib/db/repos/transactions';
	import * as m from '$lib/paraglide/messages';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
	import ImportTransactionsModal from '$lib/components/modals/ImportTransactionsModal.svelte';

	let search = $state(($page.url.searchParams.get('q') as string) ?? '');
	let editing = $state<Transaction | null>(null);
	let showEditModal = $state(false);
	let showImport = $state(false);
	let pageNum = $state(0);
	let hasNextPage = $state(false);
	const PAGE_SIZE = 50;

	const today = new Date().toISOString().split('T')[0];

	// The store holds PAGE_SIZE+1 rows so we can detect a next page; the visible
	// list is the first PAGE_SIZE. Never mutate `transactions.items` — it's a
	// shared singleton read by the dashboard, FrequentTransactions, and the
	// payee autocomplete; truncating it here corrupts those views.
	let displayItems = $derived(transactions.items.slice(0, PAGE_SIZE));

	async function loadPage() {
		await transactions.load({
			query: search || undefined,
			limit: PAGE_SIZE + 1,
			offset: pageNum * PAGE_SIZE
		});
		hasNextPage = transactions.items.length > PAGE_SIZE;
	}

	onMount(loadPage);

	async function onSearch() {
		pageNum = 0;
		await loadPage();
	}

	function openEdit(tx: Transaction) {
		editing = tx;
		showEditModal = true;
	}

	async function doDelete(tx: Transaction) {
		await transactions.delete(tx.id);
		await loadPage();
	}

	async function doDuplicate(tx: Transaction) {
		await transactions.duplicate(tx.id);
		await loadPage();
		toast.show(m.transactions_duplicated());
	}

	async function nextPage() { pageNum += 1; await loadPage(); }
	async function prevPage() { if (pageNum > 0) { pageNum -= 1; await loadPage(); } }
</script>

<div class="space-y-4">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.transactions_title()}</h1>

	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder={m.transactions_search_placeholder()} bind:value={search} />
		</div>
		<Button size="sm" variant="secondary" onclick={() => showImport = true}>{m.import_tx_title()}</Button>
		<Button size="sm" onclick={onSearch}>{m.common_search()}</Button>
	</div>

	{#if displayItems.length > 0}
		<p class="text-xs text-dim">
			{displayItems.length === 0 ? m.transactions_count_none() : m.transactions_count_many({ count: displayItems.length })}
		</p>
	{/if}

	<div class="bg-tape rounded-lg border border-line divide-y divide-line">
		{#if displayItems.length === 0}
			<EmptyState message={m.transactions_empty_state()} icon="▮▯▯▯" />
		{:else}
			{#each displayItems as tx}
				<div class="p-4 flex items-center justify-between group">
					<button onclick={() => openEdit(tx)} class="flex-1 text-left">
						<div class="text-sm text-ledger flex items-center gap-2">
							{tx.payee || labelFor(tx.kind)}
							{#if tx.date > today}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">{m.transactions_future()}</span>
							{/if}
						</div>
						<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {labelFor(tx.kind)}</div>
					</button>
					<span class="figures text-sm mr-3 {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
						{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
					</span>
					<ContextMenu label={m.transactions_duplicate() + ' · ' + m.common_delete()}>
						<button onclick={() => doDuplicate(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.transactions_duplicate()}</button>
						<button onclick={() => doDelete(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
					</ContextMenu>
				</div>
			{/each}
		{/if}
	</div>

	<div class="flex justify-between items-center text-sm">
		<Button variant="ghost" size="sm" disabled={pageNum === 0} onclick={prevPage}>{m.transactions_previous()}</Button>
		<span class="text-dim">{m.transactions_page({ page: pageNum + 1 })}</span>
		<Button variant="ghost" size="sm" disabled={!hasNextPage} onclick={nextPage}>{m.transactions_next()}</Button>
	</div>

	<ImportTransactionsModal bind:open={showImport} />
</div>

<Modal bind:open={showEditModal} title={m.transactions_edit()}>
	<TransactionForm existing={editing} onclose={() => showEditModal = false} onsave={loadPage} />
</Modal>
