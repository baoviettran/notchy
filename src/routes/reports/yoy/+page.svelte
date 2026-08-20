<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import GroupedBarChart from '$lib/components/charts/GroupedBarChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	const currentYear = new Date().getFullYear();
	let yearA = $state(currentYear - 1);
	let yearB = $state(currentYear);

	onMount(() => {
		reportsStore.loadYearOverYear(yearA, yearB);
	});

	$effect(() => {
		reportsStore.loadYearOverYear(yearA, yearB);
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
	const xFormat = (month: string) => month;
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_year_over_year()}</h1>
		<ReportsNav />
	</div>

	<div class="flex items-center gap-4">
		<div class="flex items-center gap-2">
			<label class="text-sm text-dim">{m.reports_select_year()} A:</label>
			<input
				type="number"
				bind:value={yearA}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>

		<div class="flex items-center gap-2">
			<label class="text-sm text-dim">{m.reports_select_year()} B:</label>
			<input
				type="number"
				bind:value={yearB}
				class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger w-24"
			/>
		</div>
	</div>

	{#if hasYearOverYearData}
		<div class="bg-tape rounded-lg border border-line p-4">
			<GroupedBarChart data={chartData} {yFormat} {xFormat} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_yoy()}</p>
		</div>
	{/if}
</div>
