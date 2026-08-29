<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import StackedAreaChart from '$lib/components/charts/StackedAreaChart.svelte';
	import TapeLine from '$lib/components/reports/TapeLine.svelte';
	import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { seriesColor } from '$lib/utils/palette';
	import { formatMonthShort } from '$lib/utils/date';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let loaded = $state(false);

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		void reportsStore.loadStackedComposition().then(() => (loaded = true));
	});

	function retry() {
		loaded = false;
		void reportsStore.loadStackedComposition().then(() => (loaded = true));
	}

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

	// Chart axes use magnitude only — tone carries the sign in tape lines.
	function fmt(amount: number): string {
		return isLongCurrency(amount, settings.currency, settings.locale)
			? formatCurrencyCompact(amount, settings.currency, settings.locale)
			: formatCurrency(amount, settings.currency, settings.locale);
	}

	const yFormat = (n: number) => fmt(n);
	const windowOptions = [6, 12, 24] as const;
	const xFormat = (month: string) => formatMonthShort(month, settings.locale);

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
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_composition()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex gap-1 text-sm">
			{#each windowOptions as n}
				<button
					onclick={() => (reportsStore.window = n)}
					class="px-2 min-h-9 pointer-coarse:min-h-11 rounded transition-colors {reportsStore.window === n ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim hover:text-ledger'}"
				>
					{m.reports_months({ count: n })}
				</button>
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
	{:else if chartData.length > 0 && chartData.some((point) => point.tags.length > 0)}
		<section class="surface rounded-lg border border-line p-4">
			<!-- The SVG carries its own role="img" + label; no wrapper role, so AT
			     doesn't announce the chart twice. -->
			<StackedAreaChart data={chartData} {yFormat} {xFormat} {colors} label={m.reports_composition_chart_label()} />
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
					tone="ledger"
					title={formatCurrency(tag.total, settings.currency, settings.locale)}
				/>
			{/each}
			<TapeLine label={m.reports_subtotal()} amount={fmt(grandTotal)} tone="ledger" variant="subtotal" />
		</section>
	{:else}
		<EmptyState message={m.reports_empty_composition()} glyph="register" title={m.empty_title_reports()}>
			{#snippet action()}
				<a href="/transactions" class="inline-flex items-center justify-center min-h-9 px-3 text-sm rounded-md border border-dim bg-tape text-ledger hover:border-ledger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.layout_add_transaction()}</a>
			{/snippet}
		</EmptyState>
	{/if}
</div>
