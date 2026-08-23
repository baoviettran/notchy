<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import { page } from '$app/stores';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import Money from '$lib/components/reports/Money.svelte';
	import { formatDateRelative } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import * as m from '$lib/paraglide/messages';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
	import ImportTransactionsModal from '$lib/components/modals/ImportTransactionsModal.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import type { Transaction, TransactionKind } from '$lib/db/repos/transactions';

	let search = $state($page.url.searchParams.get('q') ?? '');

	// Filter chips — empty string means "no constraint". They feed straight
	// into TransactionFilter so filtering happens in SQL, never client-side.
	let filterKind = $state('');
	let filterAccount = $state('');
	let filterTag = $state('');
	let filterMonth = $state('');

	let editing = $state<Transaction | null>(null);
	let showEditModal = $state(false);
	let showImport = $state(false);
	let showFilters = $state(false);
	let showDeleteConfirm = $state(false);
	let pendingDeleteId = $state<string | null>(null);
	let pageNum = $state(0);
	let hasNextPage = $state(false);
	const PAGE_SIZE = 50;

	const today = new Date().toISOString().split('T')[0];

	// The store holds PAGE_SIZE+1 rows so we can detect a next page; the visible
	// list is the first PAGE_SIZE. Never mutate `transactions.items` — it's a
	// shared singleton read by the dashboard, FrequentTransactions, and the
	// payee autocomplete; truncating it here corrupts those views.
	let displayItems = $derived(transactions.items.slice(0, PAGE_SIZE));

	// Any constraint beyond search is active → offer a one-click exit.
	let hasActiveFilters = $derived(Boolean(filterKind || filterAccount || filterTag || filterMonth));
	let activeFilterCount = $derived([filterKind, filterAccount, filterTag, filterMonth].filter(Boolean).length);

	function clearFilters() {
		filterKind = '';
		filterAccount = '';
		filterTag = '';
		filterMonth = '';
	}

	// Honest match count: the store holds PAGE_SIZE+1 rows, so an exact total
	// is only knowable when there is no next page — otherwise show "N+".
	let countLine = $derived.by(() => {
		if (hasNextPage) return m.transactions_count_more({ count: (pageNum + 1) * PAGE_SIZE });
		const total = pageNum * PAGE_SIZE + displayItems.length;
		return total === 0 ? m.transactions_count_none() : m.transactions_count_many({ count: total });
	});

	async function loadPage() {
		await transactions.load({
			query: search || undefined,
			kind: (filterKind || undefined) as TransactionKind | undefined,
			account_id: filterAccount || undefined,
			tag_id: filterTag || undefined,
			date_from: filterMonth ? `${filterMonth}-01` : undefined,
			date_to: filterMonth ? monthEnd(filterMonth) : undefined,
			limit: PAGE_SIZE + 1,
			offset: pageNum * PAGE_SIZE
		});
		hasNextPage = transactions.items.length > PAGE_SIZE;
	}

	function monthEnd(ym: string): string {
		const [y, mo] = ym.split('-').map(Number);
		return new Date(Date.UTC(y, mo, 0)).toISOString().split('T')[0];
	}

	onMount(() => {
		void accounts.load();
		void categories.load();
	});

	let lastFilterKey = '';
	// Re-queries whenever search (URL-driven) or any filter chip changes.
	// The key comparison keeps the effect from re-triggering off the state
	// it writes back (`search`) or off paging (`pageNum`).
	$effect(() => {
		const q = $page.url.searchParams.get('q') ?? '';
		const key = [q, filterKind, filterAccount, filterTag, filterMonth].join('|');
		if (key === lastFilterKey) return;
		lastFilterKey = key;
		if (q !== search) search = q;
		pageNum = 0;
		void loadPage();
	});

	function openEdit(tx: Transaction) {
		editing = tx;
		showEditModal = true;
	}

	function confirmDelete(tx: Transaction) {
		pendingDeleteId = tx.id;
		showDeleteConfirm = true;
	}

	async function doDelete() {
		if (!pendingDeleteId) return;
		await transactions.delete(pendingDeleteId);
		await loadPage();
		pendingDeleteId = null;
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

	<!-- One action row: filters stay behind a toggle (with an active count)
	     until they matter, and Import stops floating in its own region. -->
	<div class="flex items-center gap-2">
		<Button
			size="sm"
			variant={activeFilterCount > 0 ? 'primary' : 'secondary'}
			onclick={() => showFilters = !showFilters}
		>
			{m.transactions_filters()}
			{#if activeFilterCount > 0}
				<span class="figures ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[11px] bg-ink/20">{activeFilterCount}</span>
			{/if}
		</Button>
		<Button size="sm" variant="secondary" onclick={() => showImport = true}>{m.import_tx_title()}</Button>
	</div>

	{#if showFilters || activeFilterCount > 0}
		<div class="flex flex-wrap gap-3">
			<div class="w-44">
				<Select
					label={m.transactions_filter_kind()}
					bind:value={filterKind}
					options={[
						{ value: '', label: m.transactions_filter_all_kinds() },
						{ value: 'expense', label: m.forms_expense() },
						{ value: 'income', label: m.forms_income() },
						{ value: 'transfer', label: m.forms_transfer() },
						{ value: 'refund', label: m.forms_refund() },
						{ value: 'adjustment', label: m.forms_adjustment() }
					]}
				/>
			</div>
			<div class="w-44">
				<Select
					label={m.transactions_filter_account()}
					bind:value={filterAccount}
					options={[{ value: '', label: m.transactions_filter_all_accounts() }, ...accounts.items.map((a) => ({ value: a.id, label: a.name }))]}
				/>
			</div>
			<div class="w-44">
				<Select
					label={m.transactions_filter_tag()}
					bind:value={filterTag}
					options={[{ value: '', label: m.transactions_filter_all_tags() }, ...categories.tags.map((t) => ({ value: t.id, label: t.name }))]}
				/>
			</div>
			<div class="w-44">
				<Input type="month" label={m.transactions_filter_month()} bind:value={filterMonth} />
			</div>
		</div>
	{/if}

	{#if transactions.loading}
		<div class="bg-tape rounded-lg border border-line p-4">
			<Skeleton lines={6} />
		</div>
	{:else if transactions.error}
		<ErrorState description={transactions.error} onRetry={loadPage} />
	{:else}
		{#if displayItems.length > 0 || hasActiveFilters}
			<div class="flex items-center justify-between gap-2">
				<p class="text-xs text-dim">{countLine}</p>
				{#if hasActiveFilters}
					<Button variant="ghost" size="sm" onclick={clearFilters}>{m.transactions_filter_clear()}</Button>
				{/if}
			</div>
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
								<span class="text-[11px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">{m.transactions_future()}</span>
							{/if}
						</div>
						<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {labelFor(tx.kind)}</div>
					</button>
					<Money amount={tx.amount} glyph={tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : ''} tone={tx.kind === 'expense' ? 'debit' : tx.kind === 'income' ? 'phosphor' : 'dim'} class="mr-3" />
					<ContextMenu label={m.common_actions_for({ name: tx.payee || labelFor(tx.kind) })}>
						<button onclick={() => doDuplicate(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.transactions_duplicate()}</button>
						<button onclick={() => confirmDelete(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
					</ContextMenu>
				</div>
			{/each}
		{/if}
	</div>

	{#if pageNum > 0 || hasNextPage}
		<div class="flex justify-between items-center text-sm">
			<Button variant="ghost" size="sm" disabled={pageNum === 0} onclick={prevPage}>{m.transactions_previous()}</Button>
			<span class="text-dim">{m.transactions_page({ page: pageNum + 1 })}</span>
			<Button variant="ghost" size="sm" disabled={!hasNextPage} onclick={nextPage}>{m.transactions_next()}</Button>
		</div>
	{/if}

	<ImportTransactionsModal bind:open={showImport} />
	{/if}
</div>

<Modal bind:open={showEditModal} title={m.transactions_edit()}>
	<TransactionForm existing={editing} onclose={() => showEditModal = false} onsave={loadPage} />
</Modal>

<ConfirmDialog
	open={showDeleteConfirm}
	title={m.transactions_delete_confirm_title()}
	message={m.transactions_delete_confirm_body()}
	confirmLabel={m.common_delete()}
	danger={true}
	onconfirm={doDelete}
/>
