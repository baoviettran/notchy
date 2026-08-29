<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let loaded = $state(false);

	// Single tracked effect: fires once on mount and re-runs when the window
	// or adjustments toggle. No onMount double-fetch, no empty-state flash
	// before first resolution.
	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		void reportsStore.loadNetWorth().then(() => (loaded = true));
	});

	function retry() {
		loaded = false;
		void reportsStore.loadNetWorth().then(() => (loaded = true));
	}

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
	<h1 class="page-title">{m.reports_net_worth_over_time()}</h1>

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
	{:else}
		{#if hasNetWorthData}
			<div class="surface rounded-lg p-4">
				<LineChart data={chartData} {yFormat} {xFormat} showArea={true} label={m.reports_net_worth_chart_label()} />
			</div>
		{:else}
			<EmptyState message={m.reports_empty_net_worth()} glyph="register" title={m.empty_title_reports()}>
				{#snippet action()}
					<a href="/transactions" class="inline-flex items-center justify-center min-h-9 px-3 text-sm rounded-md border border-dim bg-tape text-ledger hover:border-ledger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.layout_add_transaction()}</a>
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</div>
