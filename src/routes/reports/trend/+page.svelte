<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { getTrend } from '$lib/db/repos/reports';
	import type { TrendPoint } from '$lib/db/repos/reports';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	let points = $state<TrendPoint[]>([]);
	let months = $state(6);
	let includeAdjustments = $state(false);

	async function load() {
		const db = await getDb();
		points = await getTrend(db, months, includeAdjustments);
	}

	onMount(load);
	$effect(() => { months; includeAdjustments; load(); });

	let maxValue = $derived(Math.max(...points.map((p) => Math.max(p.income, p.expense)), 1));
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Compare</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<div class="flex gap-1 text-sm">
			{#each [6, 12, 24] as m}
				<button onclick={() => months = m}
					class="px-2 py-1 rounded {months === m ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium' : 'text-zinc-500'}"
				>{m}mo</button>
			{/each}
		</div>
		<label class="flex items-center gap-2 text-sm text-zinc-500">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			Include adjustments
		</label>
	</div>

	{#if points.length > 0 && points.some((p) => p.income > 0 || p.expense > 0)}
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<div class="flex items-end gap-1 h-48">
				{#each points as point}
					<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
						<div class="w-full flex gap-0.5 items-end flex-1">
							<div class="flex-1 bg-emerald-400 rounded-t" style="height: {(point.income / maxValue) * 100}%"></div>
							<div class="flex-1 bg-red-400 rounded-t" style="height: {(point.expense / maxValue) * 100}%"></div>
						</div>
						<span class="text-[10px] text-zinc-400">{point.month.slice(5)}</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-4 mt-3 text-xs text-zinc-500">
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-emerald-400"></span> Income</span>
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-red-400"></span> Expense</span>
			</div>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
			{#each points as point}
				<div class="p-3 flex items-center justify-between text-sm">
					<span class="text-zinc-600 dark:text-zinc-400">{point.month}</span>
					<div class="flex gap-4 tabular-nums">
						<span class="text-emerald-600">{formatCurrency(point.income, settings.currency, settings.locale)}</span>
						<span class="text-red-500">{formatCurrency(point.expense, settings.currency, settings.locale)}</span>
						<span class="{point.net >= 0 ? 'text-emerald-600' : 'text-red-500'}">{formatCurrency(point.net, settings.currency, settings.locale)}</span>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400 min-h-[200px] flex items-center justify-center">
			<p class="text-sm">No trend data yet. Add transactions across multiple months.</p>
		</div>
	{/if}
</div>
