<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	onMount(() => {
		reportsStore.loadNetWorth();
	});

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		reportsStore.loadNetWorth();
	});

	const chartData = $derived(
		reportsStore.netWorth.map((point) => ({
			x: new Date(point.month + '-01'),
			y: point.netWorth
		}))
	);
	const hasNetWorthData = $derived(chartData.some((point) => point.y !== 0));

	const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
	const windowOptions = [6, 12, 24] as const;
	const xFormat = (d: Date) =>
		d.toLocaleDateString(settings.locale === 'vi' ? 'vi-VN' : 'en-US', {
			month: 'short',
			year: '2-digit'
		});
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_net_worth_over_time()}</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_overview()}</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_trend()}</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_compare()}</a>
			<a href="/reports/net-worth" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">{m.reports_net_worth()}</a>
			<a href="/reports/category" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_category_trend()}</a>
			<a href="/reports/composition" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_composition()}</a>
			<a href="/reports/yoy" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_year_over_year()}</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<div class="flex gap-1 text-sm">
			{#each windowOptions as n}
				<button
					onclick={() => (reportsStore.window = n)}
					class="px-2 py-1 rounded {reportsStore.window === n ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim'}"
				>
					{m.reports_months({ count: n })}
				</button>
			{/each}
		</div>
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={reportsStore.includeAdjustments} class="rounded" />
			{m.reports_include_adjustments()}
		</label>
	</div>

	{#if hasNetWorthData}
		<div class="bg-tape rounded-lg border border-line p-4">
			<LineChart data={chartData} {yFormat} {xFormat} showArea={true} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_net_worth()}</p>
		</div>
	{/if}
</div>
