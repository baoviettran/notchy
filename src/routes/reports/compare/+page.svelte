<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { getComparison } from '$lib/db/repos/reports';
	import type { CompareRow } from '$lib/db/repos/reports';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	let rows = $state<CompareRow[]>([]);
	let includeAdjustments = $state(false);

	function currentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
	function prevMonth() {
		const d = new Date();
		d.setMonth(d.getMonth() - 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	let monthA = $state(prevMonth());
	let monthB = $state(currentMonth());

	async function load() {
		const db = await getDb();
		rows = await getComparison(db, monthA, monthB, includeAdjustments);
	}

	onMount(load);
	$effect(() => { monthA; monthB; includeAdjustments; load(); });
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium">Compare</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<input type="month" bind:value={monthA} class="px-2 py-1 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50" />
		<span class="text-zinc-400">vs</span>
		<input type="month" bind:value={monthB} class="px-2 py-1 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50" />
		<label class="flex items-center gap-2 text-sm text-zinc-500">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			Adjustments
		</label>
	</div>

	{#if rows.length > 0}
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs">
						<th class="text-left p-3 font-medium">Category</th>
						<th class="text-right p-3 font-medium">{monthA}</th>
						<th class="text-right p-3 font-medium">{monthB}</th>
						<th class="text-right p-3 font-medium">Change</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-zinc-100 dark:divide-zinc-700">
					{#each rows as row}
						<tr>
							<td class="p-3 text-zinc-900 dark:text-zinc-50">{row.name}</td>
							<td class="p-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatCurrency(row.month_a, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatCurrency(row.month_b, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right tabular-nums {row.change > 0 ? 'text-red-500' : row.change < 0 ? 'text-emerald-600' : 'text-zinc-400'}">
								{row.change > 0 ? '+' : ''}{formatCurrency(row.change, settings.currency, settings.locale)}
								{#if row.change_pct !== null}
									<span class="text-xs ml-1">({row.change_pct > 0 ? '+' : ''}{Math.round(row.change_pct)}%)</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400 min-h-[200px] flex items-center justify-center">
			<p class="text-sm">No comparison data. Add expenses in both months to compare.</p>
		</div>
	{/if}
</div>
