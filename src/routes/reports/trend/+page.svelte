<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { fmtReport } from '$lib/utils/report-format';
	import { formatMonth, formatMonthShort } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let loaded = $state(false);

	const windowOptions = [6, 12, 24] as const;

	function retry() {
		loaded = false;
		void reportsStore.loadTrend().then(() => (loaded = true));
	}

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		void reportsStore.loadTrend().then(() => (loaded = true));
	});

	let maxValue = $derived(Math.max(...reportsStore.trend.map((p) => Math.max(p.income, p.expense)), 1));
	let totalIncome = $derived(reportsStore.trend.reduce((s, p) => s + p.income, 0));
	let totalExpense = $derived(reportsStore.trend.reduce((s, p) => s + p.expense, 0));
	let totalNet = $derived(totalIncome - totalExpense);
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_trend()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex gap-1 text-sm">
			{#each windowOptions as n}
				<button type="button" onclick={() => (reportsStore.window = n)}
					class="px-2 min-h-9 pointer-coarse:min-h-11 rounded transition-colors {reportsStore.window === n ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim hover:text-ledger'}"
				>{m.reports_months({ count: n })}</button>
			{/each}
		</div>
		<AdjustmentsToggle bind:checked={reportsStore.includeAdjustments} />
	</div>

	{#if reportsStore.error}
		<ErrorState description={reportsStore.error} onRetry={retry} />
	{:else if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else if reportsStore.trend.length > 0 && reportsStore.trend.some((p) => p.income > 0 || p.expense > 0)}
		<!-- The meter: each month column announces its figures to the title
		     tooltip and to assistive tech — the bars carry no values alone. -->
		<section class="surface rounded-lg border border-line p-4">
			<h2 class="plate mb-3">{m.reports_trend()}</h2>
			<div class="flex items-end gap-1 h-48">
				{#each reportsStore.trend as point (point.month)}
					{@const label = formatMonth(point.month, settings.locale) + ': ' + m.reports_income() + ' ' + formatCurrency(point.income, settings.currency, settings.locale) + ', ' + m.reports_expense() + ' ' + formatCurrency(point.expense, settings.currency, settings.locale)}
					<button
						type="button"
						aria-label={label}
						title={label}
						class="flex-1 flex flex-col items-center gap-1 h-full justify-end rounded cursor-default focus-visible:bg-line/20"
					>
						<div class="w-full flex gap-0.5 items-end flex-1">
							<div class="flex-1 bg-phosphor rounded-t" style="height: {(point.income / maxValue) * 100}%"></div>
							<div class="flex-1 bg-debit rounded-t" style="height: {(point.expense / maxValue) * 100}%"></div>
						</div>
						<span class="text-[11px] text-dim">{formatMonthShort(point.month, settings.locale)}</span>
					</button>
				{/each}
			</div>
			<div class="flex gap-4 mt-3 text-xs text-dim">
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-phosphor"></span> {m.reports_income()}</span>
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-debit"></span> {m.reports_expense()}</span>
			</div>
		</section>

		<!-- The ledger: one ruled line per month, closed by a grand total. -->
		<section class="surface rounded-lg px-4 py-3" aria-label={m.reports_trend()}>
			<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 pb-2 border-b border-dashed border-line/60">
				<span class="plate"></span>
				<span class="plate text-right">{m.reports_income()}</span>
				<span class="plate text-right">{m.reports_expense()}</span>
				<span class="plate text-right">Δ</span>
			</div>
			{#each reportsStore.trend as point (point.month)}
				<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 py-2 border-b border-line/40 text-xs sm:text-sm min-w-0">
					<span class="figures text-dim shrink-0">{formatMonthShort(point.month, settings.locale)}</span>
					<span class="figures text-phosphor text-right" title={formatCurrency(point.income, settings.currency, settings.locale)}>{fmtReport(point.income, settings.currency, settings.locale)}</span>
					<span class="figures text-debit text-right" title={formatCurrency(point.expense, settings.currency, settings.locale)}>{fmtReport(point.expense, settings.currency, settings.locale)}</span>
					<span class="figures text-right {point.net >= 0 ? 'text-phosphor' : 'text-debit'}" title={formatCurrency(point.net, settings.currency, settings.locale)}>{fmtReport(point.net, settings.currency, settings.locale)}</span>
				</div>
			{/each}
			<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 pt-2 mt-1 border-t-4 border-double border-line">
				<span class="plate !text-ledger">{m.reports_total()}</span>
				<span class="figures text-phosphor text-right">{fmtReport(totalIncome, settings.currency, settings.locale)}</span>
				<span class="figures text-debit text-right">{fmtReport(totalExpense, settings.currency, settings.locale)}</span>
				<span class="figures text-right figures-glow {totalNet >= 0 ? 'text-phosphor' : 'text-debit'}">{fmtReport(totalNet, settings.currency, settings.locale)}</span>
			</div>
		</section>
	{:else}
		<EmptyState message={m.reports_trend_empty()} glyph="register" title={m.empty_title_reports()}>
			{#snippet action()}
				<a href="/transactions" class="inline-flex items-center justify-center min-h-9 px-3 text-sm rounded-md border border-dim bg-tape text-ledger hover:border-ledger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.layout_add_transaction()}</a>
			{/snippet}
		</EmptyState>
	{/if}
</div>
