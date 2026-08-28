<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import GroupedBarChart from '$lib/components/charts/GroupedBarChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { fmtReport } from '$lib/utils/report-format';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatMonthShort } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	const currentYear = new Date().getFullYear();
	let yearA = $state(currentYear - 1);
	let yearB = $state(currentYear);

	let loaded = $state(false);

	$effect(() => {
		yearA;
		yearB;
		void reportsStore.loadYearOverYear(yearA, yearB).then(() => (loaded = true));
	});

	function retry() {
		loaded = false;
		void reportsStore.loadYearOverYear(yearA, yearB).then(() => (loaded = true));
	}

	const chartData = $derived(reportsStore.yearOverYear);
	const hasYearOverYearData = $derived(
		chartData.some(
			(point) =>
				point.yearAIncome !== 0 ||
				point.yearAExpense !== 0 ||
				point.yearBIncome !== 0 ||
				point.yearBExpense !== 0
		)
	);

	const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
	const xFormat = (month: string) => formatMonthShort(month, settings.locale);

	let totalAIncome = $derived(chartData.reduce((s, p) => s + p.yearAIncome, 0));
	let totalAExpense = $derived(chartData.reduce((s, p) => s + p.yearAExpense, 0));
	let totalBIncome = $derived(chartData.reduce((s, p) => s + p.yearBIncome, 0));
	let totalBExpense = $derived(chartData.reduce((s, p) => s + p.yearBExpense, 0));
	let totalNet = $derived((totalBIncome - totalBExpense) - (totalAIncome - totalAExpense));
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_year_over_year()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex items-center gap-2">
			<label for="yoy-year-a" class="text-sm text-dim">{m.reports_select_year()} A:</label>
			<input
				id="yoy-year-a"
				type="number"
				min="2000"
				max={currentYear}
				bind:value={yearA}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>

		<div class="flex items-center gap-2">
			<label for="yoy-year-b" class="text-sm text-dim">{m.reports_select_year()} B:</label>
			<input
				id="yoy-year-b"
				type="number"
				min="2000"
				max={currentYear}
				bind:value={yearB}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>
	</div>

	{#if reportsStore.error}
		<ErrorState description={reportsStore.error} onRetry={retry} />
	{:else if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else}
		{#if hasYearOverYearData}
			<div class="surface rounded-lg p-4">
				<GroupedBarChart data={chartData} {yFormat} {xFormat} label={m.reports_yoy_chart_label()} />
			</div>

			<!-- The ledger: one ruled line per month, closed by a grand total. -->
			<section class="surface rounded-lg px-4 py-3 overflow-x-auto" aria-label={m.reports_year_over_year()}>
				<div class="min-w-[480px]">
					<div class="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 pb-2 border-b border-dashed border-line/60">
						<span class="plate"></span>
						<span class="plate text-right">{yearA} {m.reports_income()}</span>
						<span class="plate text-right">{yearA} {m.reports_expense()}</span>
						<span class="plate text-right">{yearB} {m.reports_income()}</span>
						<span class="plate text-right">{yearB} {m.reports_expense()}</span>
						<span class="plate text-right">Δ</span>
					</div>
					{#each chartData as point (point.month)}
						{@const netA = point.yearAIncome - point.yearAExpense}
						{@const netB = point.yearBIncome - point.yearBExpense}
						{@const delta = netB - netA}
						<div class="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 py-2 border-b border-line/40 text-xs sm:text-sm min-w-0">
							<span class="figures text-dim shrink-0">{formatMonthShort(point.month, settings.locale)}</span>
							<span class="figures text-phosphor text-right" title={formatCurrency(point.yearAIncome, settings.currency, settings.locale)}>{fmtReport(point.yearAIncome, settings.currency, settings.locale)}</span>
							<span class="figures text-debit text-right" title={formatCurrency(point.yearAExpense, settings.currency, settings.locale)}>{fmtReport(point.yearAExpense, settings.currency, settings.locale)}</span>
							<span class="figures text-phosphor text-right" title={formatCurrency(point.yearBIncome, settings.currency, settings.locale)}>{fmtReport(point.yearBIncome, settings.currency, settings.locale)}</span>
							<span class="figures text-debit text-right" title={formatCurrency(point.yearBExpense, settings.currency, settings.locale)}>{fmtReport(point.yearBExpense, settings.currency, settings.locale)}</span>
							<span class="figures text-right {delta >= 0 ? 'text-phosphor' : 'text-debit'}" title={formatCurrency(delta, settings.currency, settings.locale)}>{fmtReport(delta, settings.currency, settings.locale)}</span>
						</div>
					{/each}
					<div class="grid grid-cols-[auto_1fr_1fr_1fr_1fr_1fr] gap-x-2 sm:gap-x-4 pt-2 mt-1 border-t-4 border-double border-line">
						<span class="plate !text-ledger">{m.reports_total()}</span>
						<span class="figures text-phosphor text-right">{fmtReport(totalAIncome, settings.currency, settings.locale)}</span>
						<span class="figures text-debit text-right">{fmtReport(totalAExpense, settings.currency, settings.locale)}</span>
						<span class="figures text-phosphor text-right">{fmtReport(totalBIncome, settings.currency, settings.locale)}</span>
						<span class="figures text-debit text-right">{fmtReport(totalBExpense, settings.currency, settings.locale)}</span>
						<span class="figures text-right figures-glow {totalNet >= 0 ? 'text-phosphor' : 'text-debit'}">{fmtReport(totalNet, settings.currency, settings.locale)}</span>
					</div>
				</div>
			</section>
		{:else}
			<EmptyState message={m.reports_empty_yoy()} icon="▮▯▯▯" />
		{/if}
	{/if}
</div>
