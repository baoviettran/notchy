<script lang="ts">
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
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
		<!-- Same switch vocabulary as the rest of the app — a raw native
		     checkbox would break the control language of the ledger. -->
		<button
			type="button"
			role="switch"
			aria-checked={reportsStore.includeAdjustments}
			onclick={() => (reportsStore.includeAdjustments = !reportsStore.includeAdjustments)}
			class="flex items-center gap-2 text-sm text-dim hover:text-ledger transition-colors min-h-11 pointer-coarse:min-h-9"
		>
			<span aria-hidden="true" class="w-8 h-4.5 rounded-full border border-line relative transition-colors {reportsStore.includeAdjustments ? 'bg-phosphor/20' : 'bg-ink'}">
				<span class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all {reportsStore.includeAdjustments ? 'left-4 bg-phosphor' : 'left-0.5 bg-dim'}"></span>
			</span>
			{m.reports_include_adjustments()}
		</button>
	</div>

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else}
	{#if hasNetWorthData}
		<div class="bg-tape rounded-lg border border-line p-4">
			<LineChart data={chartData} {yFormat} {xFormat} showArea={true} label={m.reports_net_worth_chart_label()} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_net_worth()}</p>
		</div>
	{/if}
	{/if}
</div>
