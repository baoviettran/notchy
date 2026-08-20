<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import StackedAreaChart from '$lib/components/charts/StackedAreaChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';
	import { seriesColor } from '$lib/utils/palette';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	onMount(() => {
		reportsStore.loadStackedComposition();
	});

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		reportsStore.loadStackedComposition();
	});

	const chartData = $derived(reportsStore.stackedComposition);

	const colors = $derived.by(() => {
		const colorMap: Record<string, string> = {};
		chartData.forEach((point) => {
			point.tags.forEach((tag) => {
				if (tag.tagId && !colorMap[tag.tagId]) {
					colorMap[tag.tagId] = seriesColor(Object.keys(colorMap).length);
				}
			});
		});
		return colorMap;
	});

	const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
	const windowOptions = [6, 12, 24] as const;
	const xFormat = (month: string) => month;
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_composition()}</h1>
		<ReportsNav />
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

	{#if chartData.length > 0 && chartData.some((point) => point.tags.length > 0)}
		<div class="bg-tape rounded-lg border border-line p-4">
			<StackedAreaChart data={chartData} {yFormat} {xFormat} {colors} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_composition()}</p>
		</div>
	{/if}
</div>
