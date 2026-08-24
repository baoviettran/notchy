<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import GroupedBarChart from '$lib/components/charts/GroupedBarChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatMonthShort } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	const currentYear = new Date().getFullYear();
	let yearA = $state(currentYear - 1);
	let yearB = $state(currentYear);

	let loaded = $state(false);

	$effect(() => {
		void reportsStore.loadYearOverYear(yearA, yearB).then(() => (loaded = true));
	});

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
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_year_over_year()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex items-center gap-4">
		<div class="flex items-center gap-2">
			<label for="yoy-year-a" class="text-sm text-dim">{m.reports_select_year()} A:</label>
			<input
				id="yoy-year-a"
				type="number"
				bind:value={yearA}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>

		<div class="flex items-center gap-2">
			<label for="yoy-year-b" class="text-sm text-dim">{m.reports_select_year()} B:</label>
			<input
				id="yoy-year-b"
				type="number"
				bind:value={yearB}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>
	</div>

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else}
	{#if hasYearOverYearData}
		<div class="bg-tape rounded-lg border border-line p-4">
			<GroupedBarChart data={chartData} {yFormat} {xFormat} label={m.reports_yoy_chart_label()} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_yoy()}</p>
		</div>
	{/if}
	{/if}
</div>
