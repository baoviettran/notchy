<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { page } from '$app/stores';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getDb } from '$lib/db';
	import { formatCurrency } from '$lib/utils/currency';
	import Money from '$lib/components/reports/Money.svelte';
	import { formatDateRelative } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import * as m from '$lib/paraglide/messages';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ImportTransactionsModal from '$lib/components/modals/ImportTransactionsModal.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import FilterSheet from '$lib/components/primitives/FilterSheet.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { uiHints } from '$lib/stores/ui-hint.svelte';
	import type { Transaction, TransactionKind } from '$lib/db/repos/transactions';

	let search = $state($page.url.searchParams.get('q') ?? '');

	// Filter chips — empty string means "no constraint". They feed straight
	// into TransactionFilter so filtering happens in SQL, never client-side.
	let filterKind = $state('');
	let filterAccount = $state('');
	let filterTag = $state('');
	let filterMonth = $state('');

	let showImport = $state(false);
	let showFilters = $state(false);
	let showDeleteConfirm = $state(false);
	let pendingDeleteTx = $state<Transaction | null>(null);
	let pageNum = $state(0);
	let hasNextPage = $state(false);
	const PAGE_SIZE = 50;

	// Bulk repair mode: multi-select rows, then retag / move / delete them as
	// one tape segment instead of N × (menu → action → confirm).
	let selectMode = $state(false);
	let selected = $state<string[]>([]);
	let batchOpen = $state(false);
	let batchMode = $state<'tag' | 'account'>('tag');
	let batchValue = $state('');
	let highlightedId = $state<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;

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
		return total === 0
			? m.transactions_count_none()
			: total === 1
				? m.transactions_count_one({ count: total })
				: m.transactions_count_many({ count: total });
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

	// Hide the FAB while the batch-action bar is visible to prevent
	// the two from overlapping on narrow screens.
	$effect(() => {
		uiHints.hideFab = selectMode && selected.length > 0;
	});

	onDestroy(() => {
		uiHints.hideFab = false;
		showFilters = false;
	});

	function confirmDelete(tx: Transaction) {
		pendingDeleteTx = tx;
		showDeleteConfirm = true;
	}

	async function doDelete() {
		if (!pendingDeleteTx) return;
		const id = pendingDeleteTx.id;
		pendingDeleteTx = null;
		await transactions.delete(id);
		selected = selected.filter((sid) => sid !== id);
		await loadPage();
		toast.show(m.transactions_deleted_toast(), {
			action: m.transactions_undo(),
			duration: 5000,
			onaction: async () => {
				const db = getDb();
				await db.transactions.restore(id);
				await loadPage();
				toast.show(m.transactions_restored_toast());
			}
		});
	}

	async function doDuplicate(tx: Transaction) {
		const newId = await transactions.duplicate(tx.id);
		await loadPage();
		toast.show(m.transactions_duplicated());
		flashRow(newId);
	}

	function flashRow(id: string) {
		highlightedId = id;
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => (highlightedId = null), 1800);
		document.querySelector(`[data-tx-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	function scrollToTop() {
		document.querySelector('main')?.scrollTo({ top: 0 });
	}

	async function nextPage() { pageNum += 1; await loadPage(); scrollToTop(); }
	async function prevPage() { if (pageNum > 0) { pageNum -= 1; await loadPage(); scrollToTop(); } }

	function toggleSelected(id: string) {
		selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
	}

	function setSelectMode(on: boolean) {
		selectMode = on;
		if (!on) selected = [];
	}

	async function bulkDelete() {
		const ids = [...selected];
		if (ids.length === 0) return;
		await transactions.deleteMany(ids);
		setSelectMode(false);
		await loadPage();
		toast.show(
			ids.length === 1
				? m.transactions_bulk_deleted_one({ count: ids.length })
				: m.transactions_bulk_deleted({ count: ids.length }),
			{
			action: m.transactions_undo(),
			duration: 5000,
			onaction: async () => {
				const db = getDb();
				for (const id of ids) await db.transactions.restore(id);
				await loadPage();
				toast.show(m.transactions_restored_toast());
			}
		});
	}

	function openBatch(mode: 'tag' | 'account') {
		batchMode = mode;
		batchValue = '';
		batchOpen = true;
	}

	async function applyBatch() {
		const ids = [...selected];
		if (ids.length === 0 || !batchValue) return;
		if (batchMode === 'tag') {
			await transactions.setTagMany(ids, batchValue);
			toast.show(
				ids.length === 1
					? m.transactions_bulk_retagged_one({ count: ids.length })
					: m.transactions_bulk_retagged({ count: ids.length })
			);
		} else {
			await transactions.setAccountMany(ids, batchValue);
			toast.show(
				ids.length === 1
					? m.transactions_bulk_moved_one({ count: ids.length })
					: m.transactions_bulk_moved({ count: ids.length })
			);
		}
		batchOpen = false;
		setSelectMode(false);
		await loadPage();
	}
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.transactions_title()}</h1>

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
		<Button
			size="sm"
			variant={selectMode ? 'primary' : 'secondary'}
			onclick={() => setSelectMode(!selectMode)}
			aria-pressed={selectMode}
		>{selectMode ? m.transactions_done() : m.transactions_select()}</Button>
	</div>

	<!-- Desktop: inline filters. -->
	{#if showFilters || activeFilterCount > 0}
		<div class="hidden md:flex flex-wrap gap-3">
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

	<!-- Mobile: slide-up filter sheet. -->
	<FilterSheet open={showFilters} onclose={() => showFilters = false}>
		<div class="flex flex-col gap-4">
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
			<Select
				label={m.transactions_filter_account()}
				bind:value={filterAccount}
				options={[{ value: '', label: m.transactions_filter_all_accounts() }, ...accounts.items.map((a) => ({ value: a.id, label: a.name }))]}
			/>
			<Select
				label={m.transactions_filter_tag()}
				bind:value={filterTag}
				options={[{ value: '', label: m.transactions_filter_all_tags() }, ...categories.tags.map((t) => ({ value: t.id, label: t.name }))]}
			/>
			<Input type="month" label={m.transactions_filter_month()} bind:value={filterMonth} />
		</div>
	</FilterSheet>

	{#if transactions.loading}
		<div class="surface rounded-lg p-4">
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

		<div class="surface rounded-lg divide-y divide-line">
			{#if displayItems.length === 0}
				<EmptyState message={m.transactions_empty_state()} icon="▮▯▯▯" />
		{:else}
			{#each displayItems as tx (tx.id)}
				<div
					data-tx-id={tx.id}
					class="p-4 flex items-center justify-between group {highlightedId === tx.id ? 'bg-phosphor/10 transition-colors' : ''}"
				>
					{#if selectMode}
						<!-- Selection replaces navigation: the whole row toggles, so a
						     sloppy thumb can't land on the wrong action. -->
						<button onclick={() => toggleSelected(tx.id)} class="flex-1 text-left" aria-pressed={selected.includes(tx.id)}>
							<span class="flex items-center gap-3">
								<span aria-hidden="true" class="w-5 h-5 shrink-0 rounded border flex items-center justify-center figures text-xs {selected.includes(tx.id) ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-transparent'}">✓</span>
								<span class="min-w-0">
									<span class="block text-sm text-ledger truncate">{tx.payee || labelFor(tx.kind)}</span>
									<span class="block text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {labelFor(tx.kind)}</span>
								</span>
							</span>
						</button>
					{:else}
						<!-- A real link, like the account rows: native semantics, middle-click,
						     focus ring for free. -->
						<a href={`/transactions/${tx.id}`} class="flex-1 text-left">
							<div class="text-sm text-ledger flex items-center gap-2">
								{tx.payee || labelFor(tx.kind)}
								{#if tx.date > today}
									<span class="text-[11px] px-1.5 py-0.5 rounded bg-phosphor/15 text-phosphor font-medium uppercase">{m.transactions_future()}</span>
								{/if}
							</div>
							<div class="text-xs text-dim">{formatDateRelative(tx.date, settings.locale)} · {labelFor(tx.kind)}</div>
						</a>
					{/if}
					<Money amount={tx.amount} glyph={tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : ''} tone={tx.kind === 'expense' ? 'debit' : tx.kind === 'income' ? 'phosphor' : 'dim'} class="mr-2 shrink-0" />
					{#if !selectMode}
						<!-- The pl-2 wrapper keeps the menu's widened hit target clear of
						     the row link — no accidental navigation from the amount side. -->
						<div class="shrink-0 pl-2">
							<ContextMenu label={m.common_actions_for({ name: tx.payee || labelFor(tx.kind) })}>
								<button onclick={() => doDuplicate(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.transactions_duplicate()}</button>
								<button onclick={() => confirmDelete(tx)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
							</ContextMenu>
						</div>
					{/if}
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

	{/if}
</div>

<!-- Lives outside the data branch: Import must work while the list is
     loading or errored, not only when rows are on screen. -->
<ImportTransactionsModal bind:open={showImport} />

<!-- Batch bar: a floating tape segment above the bottom nav. Appears only
     while rows are selected. -->
{#if selectMode && selected.length > 0}
	<div class="fixed bottom-20 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
		<div class="pointer-events-auto w-full max-w-md bg-tape border border-line rounded-lg shadow-lg p-3 flex items-center gap-2 animate-scale-in" role="toolbar" aria-label={m.transactions_selected_count({ count: selected.length })}>
			<span class="figures text-sm text-phosphor flex-1">{m.transactions_selected_count({ count: selected.length })}</span>
			<Button size="sm" variant="secondary" onclick={() => openBatch('tag')}>{m.transactions_batch_retag()}</Button>
			<Button size="sm" variant="secondary" onclick={() => openBatch('account')}>{m.transactions_batch_move()}</Button>
			<Button size="sm" variant="danger" onclick={bulkDelete}>{m.common_delete()}</Button>
			<Button size="sm" variant="ghost" onclick={() => setSelectMode(false)} aria-label={m.transactions_done()}>✕</Button>
		</div>
	</div>
{/if}

<Modal bind:open={batchOpen} title={batchMode === 'tag' ? m.transactions_batch_retag() : m.transactions_batch_move()}>
	<div class="space-y-4">
		{#if batchMode === 'tag'}
			<Select label={m.forms_tag()} bind:value={batchValue} options={[...categories.tags.map((t) => ({ value: t.id, label: t.name }))]} />
		{:else}
			<Select label={m.forms_account()} bind:value={batchValue} options={[...accounts.items.map((a) => ({ value: a.id, label: a.name }))]} />
		{/if}
		<div class="flex justify-end gap-2">
			<Button variant="ghost" onclick={() => batchOpen = false}>{m.common_cancel()}</Button>
			<Button onclick={applyBatch} disabled={!batchValue}>{m.common_save()}</Button>
		</div>
	</div>
</Modal>

<ConfirmDialog
	open={showDeleteConfirm}
	title={m.transactions_delete_confirm_title()}
	message={pendingDeleteTx
		? m.transactions_delete_confirm_body() + '\n' + m.transactions_delete_confirm_detail({
				payee: pendingDeleteTx.payee || labelFor(pendingDeleteTx.kind),
				amount: formatCurrency(pendingDeleteTx.amount, settings.currency, settings.locale),
				date: formatDateRelative(pendingDeleteTx.date, settings.locale)
			})
		: m.transactions_delete_confirm_body()}
	confirmLabel={m.common_delete()}
	danger={true}
	onconfirm={doDelete}
/>
