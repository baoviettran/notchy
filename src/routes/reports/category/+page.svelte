<script lang="ts">
	import { onMount } from 'svelte';
	import { reportsStore } from '$lib/stores/reports.svelte';
	import LineChart from '$lib/components/charts/LineChart.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb } from '$lib/db';
	import { listTags } from '$lib/db/repos/categories';
	import type { Tag } from '$lib/db/repos/categories';
	import * as m from '$lib/paraglide/messages';

	let tags = $state<Tag[]>([]);
	let selectedTagId = $state('');

	onMount(async () => {
		const db = await getDb();
		tags = await listTags(db);
		if (tags.length > 0) {
			selectedTagId = tags[0].id;
		}
	});

	$effect(() => {
		if (selectedTagId) {
			reportsStore.loadCategoryTrend(selectedTagId);
		}
	});

	$effect(() => {
		reportsStore.window;
		reportsStore.includeAdjustments;
		if (selectedTagId) {
			reportsStore.loadCategoryTrend(selectedTagId);
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
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_category_trend()}</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_overview()}</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_trend()}</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_compare()}</a>
			<a href="/reports/net-worth" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_net_worth()}</a>
			<a href="/reports/category" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">{m.reports_category_trend()}</a>
			<a href="/reports/composition" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_composition()}</a>
			<a href="/reports/yoy" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_year_over_year()}</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
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

	{#if chartData.length > 0 && chartData.some((d) => d.y !== 0)}
		<div class="bg-tape rounded-lg border border-line p-4">
			<LineChart data={chartData} {yFormat} {xFormat} showArea={false} />
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_empty_category()}</p>
		</div>
	{/if}
</div>
