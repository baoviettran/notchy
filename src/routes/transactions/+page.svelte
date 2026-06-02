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

	let search = $state('');
	let editing = $state<Transaction | null>(null);
	let showEditModal = $state(false);
	let page = $state(0);
	let hasNextPage = $state(false);
	const PAGE_SIZE = 50;

	const today = new Date().toISOString().split('T')[0];

	async function loadPage() {
		await transactions.load({
			query: search || undefined,
			limit: PAGE_SIZE + 1,
			offset: page * PAGE_SIZE
		});
		// If we got more than PAGE_SIZE, there's a next page; trim the extra
		hasNextPage = transactions.items.length > PAGE_SIZE;
		if (hasNextPage) transactions.items = transactions.items.slice(0, PAGE_SIZE);
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
		toast.show('Transaction duplicated.');
	}

	async function nextPage() { page += 1; await loadPage(); }
	async function prevPage() { if (page > 0) { page -= 1; await loadPage(); } }
</script>

<div class="space-y-4">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Transactions</h1>

	<div class="flex gap-2">
		<div class="flex-1">
			<Input type="search" placeholder="Search payee, description..." bind:value={search} />
		</div>
		<Button size="sm" onclick={onSearch}>Search</Button>
	</div>

	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
		{#if transactions.items.length === 0}
			<div class="text-center py-12 text-zinc-400">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">No transactions found.</p>
			</div>
		{:else}
			{#each transactions.items as tx}
				<div class="p-4 flex items-center justify-between group">
					<button onclick={() => openEdit(tx)} class="flex-1 text-left">
						<div class="text-sm text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
							{tx.payee || tx.kind}
							{#if tx.date > today}
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium uppercase">Future</span>
							{/if}
						</div>
						<div class="text-xs text-zinc-500">{formatDateRelative(tx.date, settings.locale)} · {tx.kind}</div>
					</button>
					<span class="text-sm tabular-nums mr-3 {tx.kind === 'expense' ? 'text-red-500' : tx.kind === 'income' ? 'text-emerald-500' : 'text-zinc-500'}">
						{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
					</span>
					<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onclick={() => doDuplicate(tx)} class="text-xs text-zinc-500 hover:text-emerald-600 px-2" title="Duplicate">↻</button>
						<button onclick={() => doDelete(tx)} class="text-xs text-zinc-500 hover:text-red-500 px-2" title="Delete">✕</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<div class="flex justify-between items-center text-sm">
		<Button variant="ghost" size="sm" disabled={page === 0} onclick={prevPage}>← Previous</Button>
		<span class="text-zinc-500">Page {page + 1}</span>
		<Button variant="ghost" size="sm" disabled={!hasNextPage} onclick={nextPage}>Next →</Button>
	</div>
</div>

<Modal bind:open={showEditModal} title="Edit transaction">
	<TransactionForm existing={editing} onclose={() => showEditModal = false} onsave={loadPage} />
</Modal>
