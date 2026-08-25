<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
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

	const chartData = $derived(
		reportsStore.categoryTrend.map((point) => ({
			x: new Date(point.month + '-01'),
			y: point.spent
		}))
	);

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
		<select bind:value={selectedTagId} class="bg-tape border border-line rounded-md px-3 py-1.5 text-sm text-ledger">
			<option value="">{m.reports_select_tag()}</option>
			{#each tags as tag}
				<option value={tag.id}>{tag.name}</option>
			{/each}
		</select>

		<div class="flex gap-1 text-sm">
			{#each windowOptions as n}
				<button
					onclick={() => (reportsStore.window = n)}
					class="px-2 min-h-9 pointer-coarse:min-h-11 rounded {reportsStore.window === n ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim'}"
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
	{:else}
	{#if loaded && chartData.length > 0 && chartData.some((d) => d.y !== 0)}
		<div class="bg-tape rounded-lg border border-line p-4">
			<LineChart data={chartData} {yFormat} {xFormat} showArea={false} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_category()}</p>
		</div>
	{/if}
	{/if}
</div>
