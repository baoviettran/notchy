<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import FrequentTransactions from '$lib/components/sections/FrequentTransactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { categories, systemName } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import Money from '$lib/components/reports/Money.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { formatDateRelative, formatMonth } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import * as m from '$lib/paraglide/messages';

	// Bucket display names come from the localized catalogue — never the raw
	// bucket_ slug.
	function bucketName(typeId: string): string {
		return systemName(typeId)
			?? categories.buckets.find((b) => b.id === typeId)?.name
			?? m.dashboard_uncategorized_bucket();
	}

	// Goals print how far is left in currency, not just a percentage — the only
	// progress on the page where "how far's left" otherwise demands mental math.
	function goalRemaining(target: number, current: number): string {
		const left = Math.max(0, target - current);
		return isLongCurrency(left, settings.currency, settings.locale)
			? formatCurrencyCompact(left, settings.currency, settings.locale)
			: formatCurrency(left, settings.currency, settings.locale);
	}

	let isLoading = $derived(transactions.loading || accounts.loading || budgets.loading || goals.loading);
	let storeError = $derived(transactions.error || accounts.error || budgets.error || goals.error || categories.error || null);
	// The skeleton is for the first paint only. Background refreshes (a repeat
	// save, an undo) re-run the stores' loads — collapsing a fully-populated
	// machine to four gray lines mid-celebration punishes the user's win.
	let initialLoadDone = $state(false);
	function reloadDashboard() {
		void Promise.all([accounts.load(), budgets.load(), transactions.load({ limit: 5 }), goals.load(), transactions.loadMonthFlow()]);
	}

	let recentTxns = $derived(transactions.items.slice(0, 5));
	let totalAssets = $derived(accounts.assets.reduce((s, a) => s + a.balance, 0));
	let totalLiabilities = $derived(accounts.liabilities.reduce((s, a) => s + Math.abs(a.balance), 0));
	let netPosition = $derived(totalAssets - totalLiabilities);
	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let totalSpent = $derived(budgets.items.reduce((s, b) => s + b.spent, 0));
	let budgetPct = $derived(totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0);

	// Empty-budget teaching state: a sample month that shows the shape of a
	// budget before the user has made one. The amounts are illustrative, scaled
	// to a believable magnitude for the user's currency so the example reads in
	// their money rather than an abstract unit.
	const sampleScale = settings.currency === 'VND' ? 1_000_000 : 100;
	const sampleBuckets = [
		{ name: m.dashboard_sample_rent(), spent: 6 * sampleScale, allocated: 6 * sampleScale },
		{ name: m.dashboard_sample_groceries(), spent: 4 * sampleScale, allocated: 6 * sampleScale },
		{ name: m.dashboard_sample_savings(), spent: 3 * sampleScale, allocated: 6 * sampleScale }
	];

	let monthFlow = $derived(transactions.monthFlow);

	// Vietnamese billions ("₫12.345.678.900") wrap mid-digit at display size.
	// The hero shows the compact form by default; pressing it reads the full
	// precision — the machine prints the whole figure on demand, never hides it.
	let netExact = $state(false);
	const netIsLong = $derived(isLongCurrency(netPosition, settings.currency, settings.locale));
	const netFigure = $derived(formatCurrency(Math.abs(netPosition), settings.currency, settings.locale));

	// The net figure stands alone — a single VFD readout. A ladder of
	// magnitude ticks only crowded it without encoding anything the number
	// doesn't already say.
	// Human-readable fallback for transactions without a payee — name the entry
	// by what it is to the person reading the list, never the raw system kind.
	// (labelFor / KIND_LABELS live in src/lib/utils/tx-kind.ts.)

	onMount(async () => {
		try {
			await Promise.all([accounts.load(), budgets.load(), categories.load(), transactions.load({ limit: 5 }), goals.load(), transactions.loadMonthFlow()]);
		} finally {
			initialLoadDone = true;
		}
	});
</script>

<div class="space-y-6">
	{#if isLoading && !initialLoadDone && !storeError}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={4} />
		</div>
	{:else if storeError}
		<ErrorState description={storeError} onRetry={reloadDashboard} />
	{:else}
	<header class="flex items-center justify-between">
		<h1 class="page-title">{m.nav_dashboard()}</h1>
		<span class="plate">{formatMonth(budgets.month, settings.locale)}</span>
	</header>

	<!-- SIGNATURE: net position as a VFD readout. -->
	<section class="surface rounded-lg p-5 md:p-6 relative overflow-hidden" data-tour="net">
		<div class="flex items-center justify-between mb-4">
			<h2 class="plate">{m.dashboard_net_position()}</h2>
			<a href="/accounts" class="plate hover:text-ledger transition-colors hit">{m.dashboard_accounts_link()}</a>
		</div>

		<div class="min-w-0">
			<!-- The readout wears the ledger's own semantics: positive figures
			     glow amber, negative figures print in debit ink with a literal
			     minus — owing money never glows like a win. -->
			{#if netIsLong}
				<button
					type="button"
					onclick={() => (netExact = !netExact)}
					title={netFigure}
					aria-label="{m.dashboard_net_position()}: {netFigure}"
					aria-describedby="net-expand-hint"
					class="text-4xl md:text-5xl leading-none text-left {netPosition < 0 ? 'figures text-debit' : 'figures-glow'} {netIsLong && !netExact
						? 'truncate block max-w-full cursor-pointer border-b border-dotted border-line/70 hover:bg-line/10 transition-colors'
						: 'break-all cursor-pointer hover:bg-line/10 transition-colors'}"
				>
					{netPosition < 0 ? '−' : ''}{!netExact
						? formatCurrencyCompact(Math.abs(netPosition), settings.currency, settings.locale)
						: netFigure}
				</button>
				<p id="net-expand-hint" class="mt-1 text-xs text-dim">{m.dashboard_tap_to_expand()}</p>
			{:else}
				<!-- A short figure has nothing to expand — printing it as a button
				     would announce a control that does nothing. -->
				<span class="block text-4xl md:text-5xl leading-none {netPosition < 0 ? 'figures text-debit' : 'figures-glow'}">
					{netPosition < 0 ? '−' : ''}{netFigure}
				</span>
			{/if}
			{#if monthFlow !== null}
				{@const flowFigure = isLongCurrency(monthFlow, settings.currency, settings.locale)
					? formatCurrencyCompact(Math.abs(monthFlow), settings.currency, settings.locale)
					: formatCurrency(Math.abs(monthFlow), settings.currency, settings.locale)}
				<div class="mt-3 flex items-center gap-2 text-sm">
					<span class="figures {monthFlow >= 0 ? 'text-phosphor' : 'text-debit'}">
						<span aria-hidden="true">{monthFlow >= 0 ? '▲' : '▼'} {flowFigure}</span>
						<span class="sr-only">{monthFlow >= 0 ? m.dashboard_flow_up() : m.dashboard_flow_down()}, {flowFigure}</span>
					</span>
					<span class="text-dim">{m.dashboard_month_flow()}</span>
				</div>
			{/if}
		</div>

		<div class="mt-5 pt-4 border-t border-line grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="plate mb-1">{m.dashboard_assets()}</p>
				<p class="figures text-ledger">{formatCurrency(totalAssets, settings.currency, settings.locale)}</p>
			</div>
			<div>
				<p class="plate mb-1">{m.dashboard_liabilities()}</p>
				<p class="figures text-debit">{formatCurrency(totalLiabilities, settings.currency, settings.locale)}</p>
			</div>
		</div>
	</section>

	<div class="space-y-4">
		<!-- THIS MONTH: segmented budget meter. -->
		<section class="surface rounded-lg p-5">
			<!-- flex-wrap: the Vietnamese plate runs long and wraps on compact
			     widths; the link must wrap as a whole (arrow never orphans). -->
			<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-3">
				<h2 class="plate">{m.dashboard_this_month()}</h2>
				<a href="/budgets" class="plate hover:text-ledger transition-colors hit whitespace-nowrap">{m.dashboard_budgets_link()}</a>
			</div>
			{#if budgets.hasAllocations && totalAllocated > 0}
				<div class="flex items-baseline gap-3 mb-3">
					<span class="figures text-2xl leading-none">{formatCurrency(totalSpent, settings.currency, settings.locale)}</span>
					<span class="text-sm text-dim figures">/ {formatCurrency(totalAllocated, settings.currency, settings.locale)}</span>
					<span class="ml-auto plate">{budgetPct}%</span>
				</div>
				<Progress value={budgetPct} max={100} label={m.layout_budget()} />
				<div class="mt-4 space-y-1.5">
					{#each budgets.items.slice(0, 4) as b (b.type_id)}
						{@const bPct = b.allocated > 0 ? Math.round((b.spent / b.allocated) * 100) : 0}
						{@const spentFig = isLongCurrency(b.spent, settings.currency, settings.locale) ? formatCurrencyCompact(b.spent, settings.currency, settings.locale) : formatCurrency(b.spent, settings.currency, settings.locale)}
						{@const allocFig = isLongCurrency(b.allocated, settings.currency, settings.locale) ? formatCurrencyCompact(b.allocated, settings.currency, settings.locale) : formatCurrency(b.allocated, settings.currency, settings.locale)}
						{@const anyLong = isLongCurrency(b.spent, settings.currency, settings.locale) || isLongCurrency(b.allocated, settings.currency, settings.locale)}
						<div class="flex items-center justify-between text-xs gap-2" aria-label="{bucketName(b.type_id)}: {formatCurrency(b.spent, settings.currency, settings.locale)} of {formatCurrency(b.allocated, settings.currency, settings.locale)} ({bPct}%)">
							<span class="text-dim truncate">{bucketName(b.type_id)}</span>
							<div class="flex items-center gap-2 shrink-0">
								<div class="w-12 h-1 rounded-full bg-line/40 overflow-hidden">
									<div class="h-full rounded-full {bPct > 100 ? 'bg-debit' : 'bg-phosphor/70'}" style="width: {Math.min(bPct, 100)}%"></div>
								</div>
								<span class="figures text-ledger" title="{formatCurrency(b.spent, settings.currency, settings.locale)} / {formatCurrency(b.allocated, settings.currency, settings.locale)}">
									{#if bPct > 100}<span class="text-debit" aria-hidden="true">⚠︎ </span>{/if}<span aria-hidden={anyLong ? 'true' : undefined}>{spentFig} <span class="text-dim">/ {allocFig}</span></span>
									{#if anyLong}<span class="sr-only">{formatCurrency(b.spent, settings.currency, settings.locale)} / {formatCurrency(b.allocated, settings.currency, settings.locale)}</span>{/if}
								</span>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-dim">{m.dashboard_no_budget({ month: formatMonth(budgets.month, settings.locale) })}</p>
				<p class="mt-1 text-sm text-dim">{m.dashboard_budget_teach()}</p>
				<div class="mt-4 space-y-3">
					<p class="plate">{m.dashboard_sample_tag()}</p>
					{#each sampleBuckets as s (s.name)}
						<div>
							<div class="flex items-center justify-between text-xs mb-1">
								<span class="text-ledger">{s.name}</span>
								<span class="figures text-ledger">{formatCurrency(s.spent, settings.currency, settings.locale)} <span class="text-dim">/ {formatCurrency(s.allocated, settings.currency, settings.locale)}</span></span>
							</div>
							<Progress value={Math.round((s.spent / s.allocated) * 100)} max={100} size="sm" label={s.name} />
						</div>
					{/each}
				</div>
				<div class="mt-4 text-right">
					<a href="/budgets" class="text-phosphor hover:underline text-sm">{m.dashboard_setup_budget()}</a>
				</div>
			{/if}
		</section>

		<FrequentTransactions />
	</div>

	<!-- RECENT: the ledger tape. -->
	<section class="surface rounded-lg overflow-hidden">
		<div class="flex items-center justify-between px-5 pt-4 pb-3">
			<h2 class="plate">{m.dashboard_recent()}</h2>
			<a href="/transactions" class="plate hover:text-ledger transition-colors hit">{m.dashboard_view_all()}</a>
		</div>
		{#if recentTxns.length === 0}
			<div class="px-5 pb-2">
				<EmptyState message={m.dashboard_no_txns_yet({ shortcut: 'N' })} icon="▮▯▯▯" />
			</div>
		{:else}
			<ul class="divide-y divide-line border-t border-line">
				{#each recentTxns as tx (tx.id)}
					<!-- Same contract as every other transaction row in the app:
					     tapping it opens the record. -->
					<li class="px-5 py-3">
						<a href={`/transactions/${tx.id}`} class="flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="text-sm text-ledger truncate">{tx.payee || labelFor(tx.kind)}</p>
								<p class="plate mt-0.5">{formatDateRelative(tx.date, settings.locale)}</p>
							</div>
							<Money amount={tx.amount} glyph={tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : ''} tone={tx.kind === 'expense' ? 'debit' : tx.kind === 'income' ? 'phosphor' : 'dim'} />
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- GOALS -->
	{#if goals.dashboard.length > 0}
		<section class="surface rounded-lg p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="plate">{m.dashboard_goals_header()}</h2>
				<a href="/goals" class="plate hover:text-ledger transition-colors hit">{m.dashboard_view_all()}</a>
			</div>
			<div class="space-y-3">
				{#each goals.dashboard.slice(0, 3) as g (g.id)}
					<div>
						<div class="flex items-center justify-between text-sm mb-1">
							<span class="text-ledger">{g.name}</span>
							<span class="figures text-dim">{g.progress_pct}% · {m.dashboard_goals_left({ amount: goalRemaining(g.target_amount, g.current_amount) })}</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" segments={16} label={g.name} />
					</div>
				{/each}
			</div>
		</section>
	{/if}
	{/if}
</div>
