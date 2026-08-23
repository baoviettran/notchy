<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import StackedAreaChart from '$lib/components/charts/StackedAreaChart.svelte';
	import TapeLine from '$lib/components/reports/TapeLine.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { seriesColor } from '$lib/utils/palette';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let loaded = $state(false);

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		void reportsStore.loadStackedComposition().then(() => (loaded = true));
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

	function fmt(amount: number): string {
		return isLongCurrency(amount, settings.currency, settings.locale)
			? formatCurrencyCompact(amount, settings.currency, settings.locale)
			: formatCurrency(amount, settings.currency, settings.locale);
	}

	const yFormat = (n: number) => fmt(n);
	const windowOptions = [6, 12, 24] as const;
	const xFormat = (month: string) => month;

	// Per-tag totals across the window: the ruled lines that make the chart
	// decorative under the Decorative-Meter Rule. The meter paints; this
	// tape speaks.
	const tagTotals = $derived.by(() => {
		const totals = new Map<string, { name: string; total: number }>();
		chartData.forEach((point) => {
			point.tags.forEach((tag) => {
				if (tag.tagId === null) return;
				const entry = totals.get(tag.tagId) ?? { name: tag.name, total: 0 };
				entry.total += tag.total;
				totals.set(tag.tagId, entry);
			});
		});
		return [...totals.entries()].sort((a, b) => b[1].total - a[1].total);
	});
	const grandTotal = $derived(tagTotals.reduce((s, [, t]) => s + t.total, 0));

	let chartSummary = $derived(
		m.reports_spending_by_bucket() + ' — ' + m.reports_months({ count: reportsStore.window })
	);
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_composition()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

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

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else if chartData.length > 0 && chartData.some((point) => point.tags.length > 0)}
		<section class="surface rounded-lg border border-line p-4">
			<div role="img" aria-label={chartSummary}>
				<StackedAreaChart data={chartData} {yFormat} {xFormat} {colors} />
			</div>
		</section>

		<!-- The data, printed: per-tag ruled totals so the meter above stays
		     decorative under the Decorative-Meter Rule. -->
		<section class="surface rounded-lg px-4 py-3">
			<h2 class="plate mb-2">{m.reports_spending_by_bucket()}</h2>
			{#each tagTotals as [tagId, tag] (tagId)}
				<TapeLine
					label={tag.name}
					amount={fmt(tag.total)}
					note={grandTotal > 0 ? Math.round((tag.total / grandTotal) * 100) + '%' : '0%'}
					tone="dim"
					title={formatCurrency(tag.total, settings.currency, settings.locale)}
				/>
			{/each}
			<TapeLine label={m.reports_subtotal()} amount={fmt(grandTotal)} tone="ledger" variant="subtotal" />
		</section>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_composition()}</p>
		</div>
	{/if}
</div>
