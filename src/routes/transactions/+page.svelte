<script lang="ts">
	import { onMount } from 'svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';
	import type { Transaction } from '$lib/db/repos/transactions';
	import * as m from '$lib/paraglide/messages';

	let search = $state('');
	let editing = $state<Transaction | null>(null);
	let showEditModal = $state(false);
	let page = $state(0);
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
			offset: page * PAGE_SIZE
		});
		hasNextPage = transactions.items.length > PAGE_SIZE;
	}

	onMount(loadPage);

	async function onSearch() {
		page = 0;
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

	async function nextPage() { page += 1; await loadPage(); }
	async function prevPage() { if (page > 0) { page -= 1; await loadPage(); } }
</script>

<div class="space-y-4">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.transactions_title()}</h1>

	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder={m.transactions_search_placeholder()} bind:value={search} />
		</div>
		<Button size="sm" onclick={onSearch}>{m.common_search()}</Button>
	</div>

	<div class="bg-tape rounded-lg border border-line divide-y divide-line">
		{#if displayItems.length === 0}
			<div class="text-center py-12 text-dim">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">{m.transactions_empty_state()}</p>
			</div>
		{:else}
			{#each displayItems as tx}
				<div class="p-4 flex items-center justify-between group">
					<button onclick={() => openEdit(tx)} class="flex-1 text-left">
						<div class="text-sm text-ledger flex items-center gap-2">
							{tx.payee || tx.kind}
							{#if tx.date > today}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">{m.transactions_future()}</span>
							{/if}
						</div>
						<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {tx.kind}</div>
					</button>
					<span class="figures text-sm mr-3 {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
						{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
					</span>
					<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onclick={() => doDuplicate(tx)} class="text-xs text-dim hover:text-phosphor px-2" title={m.transactions_duplicate()}>↻</button>
						<button onclick={() => doDelete(tx)} class="text-xs text-dim hover:text-debit px-2" title={m.common_delete()}>✕</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<div class="flex justify-between items-center text-sm">
		<Button variant="ghost" size="sm" disabled={page === 0} onclick={prevPage}>{m.transactions_previous()}</Button>
		<span class="text-dim">{m.transactions_page({ page: page + 1 })}</span>
		<Button variant="ghost" size="sm" disabled={!hasNextPage} onclick={nextPage}>{m.transactions_next()}</Button>
	</div>
</div>

<Modal bind:open={showEditModal} title={m.transactions_edit()}>
	<TransactionForm existing={editing} onclose={() => showEditModal = false} onsave={loadPage} />
</Modal>
