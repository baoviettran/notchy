<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb } from '$lib/db';
	import type { Tag } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let tags = $state<Tag[]>([]);
	let selectedTagId = $state('');

	onMount(async () => {
		const db = getDb();
		tags = await db.categories.listTags();
		if (tags.length > 0) {
			selectedTagId = tags[0].id;
		}
	});

	let loaded = $state(false);

	// One merged effect: tag selection, window, and adjustments all track
	// here. (onMount keeps only the tag-list bootstrap.)
	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		if (selectedTagId) {
			void reportsStore.loadCategoryTrend(selectedTagId).then(() => (loaded = true));
		}
	});

	function retry() {
		if (!selectedTagId) return;
		loaded = false;
		void reportsStore.loadCategoryTrend(selectedTagId).then(() => (loaded = true));
	}

	const chartData = $derived(
		reportsStore.categoryTrend.map((point) => ({
			x: new Date(point.month + '-01'),
			y: point.spent
		}))
	);

	const tagOptions = $derived([
		{ value: '', label: m.reports_select_tag() },
		...tags.map((t) => ({ value: t.id, label: t.name }))
	]);

	const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
	const windowOptions = [6, 12, 24] as const;
	const xFormat = (d: Date) =>
		d.toLocaleDateString(settings.locale === 'vi' ? 'vi-VN' : 'en-US', {
			month: 'short',
			year: '2-digit'
		});
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_category_trend()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="w-48">
			<Select bind:value={selectedTagId} options={tagOptions} />
		</div>

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
		{#if chartData.length > 0 && chartData.some((d) => d.y !== 0)}
			<div class="surface rounded-lg p-4">
				<LineChart data={chartData} {yFormat} {xFormat} showArea={false} />
			</div>
		{:else}
		<div class="surface rounded-lg">
			<EmptyState message={m.reports_empty_category()} glyph="register" title={m.empty_title_reports()}>
				{#snippet action()}
					<a href="/transactions" class="inline-flex items-center justify-center min-h-9 px-3 text-sm font-medium pointer-coarse:min-h-11 rounded-md border border-dim bg-tape text-ledger hover:border-ledger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.layout_add_transaction()}</a>
				{/snippet}
			</EmptyState>
		</div>
		{/if}
	{/if}
</div>
