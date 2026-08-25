<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getDb } from '$lib/db';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { parseAmount } from '$lib/utils/number_parse';
	import { formatMonth } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';

	let editing = $state<string | null>(null);
	let editValue = $state('');
	let editError = $state('');
	let monthIncome = $state(0);
	let hasPrevAllocations = $state(false);
	let editInputEl = $state<HTMLInputElement>();

	async function loadMonthIncome() {
		// Soft over-allocation ceiling: this month's income (kind='income') plus
		// cumulative rolled-over surpluses. A non-blocking warning fires when
		// total allocated exceeds it.
		try {
			const db = getDb();
			const overview = await db.reports.getOverview(budgets.month);
			monthIncome = overview.total_income;
			const rolled = budgets.items.reduce((s, b) => s + (b.rolled_over > 0 ? b.rolled_over : 0), 0);
			monthIncome += rolled;
		} catch {
			// The ceiling warning is advisory — keep the last known value rather
			// than throwing out of onMount/effect contexts.
		}
	}

	onMount(async () => {
		await categories.load();
		await budgets.load();
		await loadMonthIncome();
	});

	// Refresh the ceiling whenever allocations change (e.g. after a roll-over or
	// a new month). loadMonthIncome re-reads budgets.items for the rolled total.
	// Also re-check whether the previous month has allocations (for the
	// "Copy from previous" guard).
	$effect(() => { budgets.items; budgets.month; void loadMonthIncome(); void checkPrevAllocations(); });

	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let overAmount = $derived(Math.max(0, totalAllocated - monthIncome));

	function bucketName(typeId: string): string {
		// Never print the raw bucket_ slug (DESIGN.md's Don't list) — an
		// unknown id falls back to a localized label.
		return categories.buckets.find((b) => b.id === typeId)?.name ?? m.dashboard_uncategorized_bucket();
	}

	function prevMonth() {
		const [y, m] = budgets.month.split('-').map(Number);
		const d = new Date(y, m - 2, 1);
		budgets.load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	function nextMonth() {
		const [y, m] = budgets.month.split('-').map(Number);
		const d = new Date(y, m, 1);
		budgets.load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	let editOriginal = $state('');

	function startEdit(typeId: string, current: number) {
		editing = typeId;
		editValue = current > 0 ? String(current) : '';
		editOriginal = editValue;
		editError = '';
	}

	// Commit on blur when dirty — outside clicks and tab-aways land the
	// allocation instead of silently discarding a half-typed ritual. Escape
	// and ✕ remain explicit cancels.
	function blurEdit() {
		if (editing === null || editValue.trim() === editOriginal.trim()) {
			editing = null;
			return;
		}
		if (editing && editError === '') void saveEdit(editing);
	}

	async function saveEdit(typeId: string) {
		try {
			const parsed = editValue.trim() ? parseAmount(editValue, settings.locale, settings.currency) : 0;
			await budgets.setAllocation(typeId, parsed);
			toast.show(m.budgets_updated());
			editing = null;
			editError = '';
		} catch {
			// Field-level: the problem lives next to the input, not in a toast.
			editError = m.validation_invalid_amount();
		}
	}

	const budgetableBuckets = $derived(categories.buckets.filter((b) => b.budgetable));

	// Guard "Copy from previous": only show when the previous month actually
	// has allocations to copy. Without this, the button appears on the very
	// first month where there's nothing behind it.
	function previousMonthKey(m: string): string {
		const [y, mo] = m.split('-').map(Number);
		return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
	}

	async function checkPrevAllocations() {
		const prev = previousMonthKey(budgets.month);
		hasPrevAllocations = await getDb().budgets.hasAllocations(prev);
	}

	function getBudget(typeId: string) {
		return budgets.items.find((b) => b.type_id === typeId);
	}

	// Focus lands in the field the moment inline edit opens.
	$effect(() => { if (editing) queueMicrotask(() => editInputEl?.focus()); });
</script>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-y-2">
		<h1 class="page-title">{m.budgets_title()}</h1>
		<div class="flex items-center gap-2 text-sm">
			<button onclick={prevMonth} aria-label={m.budgets_previous_month()} class="min-w-11 min-h-11 inline-flex items-center justify-center text-dim hover:text-ledger rounded hover:bg-line/40">◀</button>
			<span class="figures font-medium text-ledger">{formatMonth(budgets.month, settings.locale)}</span>
			<button onclick={nextMonth} aria-label={m.budgets_next_month()} class="min-w-11 min-h-11 inline-flex items-center justify-center text-dim hover:text-ledger rounded hover:bg-line/40">▶</button>
		</div>
	</div>

	{#if budgets.loading}
		<div class="surface rounded-lg p-4">
			<Skeleton lines={5} />
		</div>
	{:else if budgets.error || categories.error}
		<ErrorState description={(budgets.error || categories.error) ?? ''} onRetry={() => { void categories.load(); void budgets.load(); }} />
	{:else}
	{#if !budgets.hasAllocations}
		<div class="bg-phosphor/10 border border-phosphor/30 rounded-lg p-4 flex items-center justify-between">
			<p class="text-sm text-phosphor">{m.budgets_no_budget_for_month()}</p>
			{#if hasPrevAllocations}
				<Button size="sm" variant="secondary" onclick={() => budgets.copyFromPrevious()}>{m.budgets_copy_from_previous()}</Button>
			{/if}
		</div>
	{/if}

	{#if overAmount > 0}
		<div class="bg-debit/10 border border-debit/30 rounded-lg p-3">
			<p class="text-sm text-debit">{m.budgets_over_allocated({ amount: formatCurrency(overAmount, settings.currency, settings.locale) })}</p>
		</div>
	{/if}

	<div class="space-y-4">
		{#each budgetableBuckets as bucket}
			{@const b = getBudget(bucket.id)}
			{@const allocated = b?.allocated ?? 0}
			{@const spent = b?.spent ?? 0}
			{@const rolledOver = b?.rolled_over ?? 0}
			{@const available = b?.available ?? allocated - spent}
			{@const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0}
			<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-ledger">{bucket.name}</h3>
				{#if editing === bucket.id}
					<div class="flex gap-1.5 items-center">
						<input
							bind:value={editValue}
							bind:this={editInputEl}
							onblur={blurEdit}
							onkeydown={(e) => { if (e.key === 'Enter') saveEdit(bucket.id); if (e.key === 'Escape') editing = null; }}
							placeholder="0"
							aria-label={bucket.name}
							aria-invalid={editError ? 'true' : undefined}
							aria-describedby={editError ? `budget-edit-error-${bucket.id}` : undefined}
							class="figures w-32 px-2 py-1 text-xs rounded border bg-ink text-ledger text-right {editError ? 'border-debit' : 'border-line'}"
						/>
						<button onmousedown={(e) => e.preventDefault()} onclick={() => saveEdit(bucket.id)} aria-label={m.common_save()} class="min-w-11 min-h-11 inline-flex items-center justify-center text-sm text-phosphor rounded hover:bg-line/40">✓</button>
						<button onmousedown={(e) => e.preventDefault()} onclick={() => editing = null} aria-label={m.common_cancel()} class="min-w-11 min-h-11 inline-flex items-center justify-center text-sm text-dim rounded hover:bg-line/40">✕</button>
					</div>
					{:else}
						<button type="button" onclick={() => startEdit(bucket.id, allocated)} class="figures text-xs text-dim hover:text-phosphor text-right"
							title="{formatCurrency(spent, settings.currency, settings.locale)} / {formatCurrency(allocated, settings.currency, settings.locale)}"
						>
							{isLongCurrency(spent, settings.currency, settings.locale) ? formatCurrencyCompact(spent, settings.currency, settings.locale) : formatCurrency(spent, settings.currency, settings.locale)}
							/ {isLongCurrency(allocated, settings.currency, settings.locale) ? formatCurrencyCompact(allocated, settings.currency, settings.locale) : formatCurrency(allocated, settings.currency, settings.locale)}
						</button>
					{/if}
				</div>
				{#if editing === bucket.id && editError}
					<p id={`budget-edit-error-${bucket.id}`} role="alert" class="text-xs text-debit">{editError}</p>
				{/if}
				<Progress value={pct} max={100} size="sm" label={bucket.name} />
				{#if rolledOver !== 0}
					<div class="text-xs text-dim">
						{m.budgets_rolled_in({ amount: formatCurrency(rolledOver, settings.currency, settings.locale) })}
					</div>
				{/if}
				<div class="flex justify-between text-xs text-dim">
					<span>{pct}% {m.budgets_used()}</span>
					<!-- A negative balance is a warning, not a footnote: debit ink
					     while the figure itself carries the number. -->
					<span class={available < 0 ? 'text-debit' : ''}>{formatCurrency(available, settings.currency, settings.locale)} {m.budgets_available()}</span>
				</div>
			</div>
		{/each}
	</div>
	{/if}
</div>
