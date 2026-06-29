<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { getTrend } from '$lib/db/repos/reports';
	import type { TrendPoint } from '$lib/db/repos/reports';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import * as m from '$lib/paraglide/messages';

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
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_title()}</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_overview()}</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">{m.reports_trend()}</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_compare()}</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<div class="flex gap-1 text-sm">
			{#each [6, 12, 24] as m}
				<button onclick={() => months = m}
					class="px-2 py-1 rounded {months === m ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim'}"
				>{m}mo</button>
			{/each}
		</div>
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			{m.reports_include_adjustments()}
		</label>
	</div>

	{#if points.length > 0 && points.some((p) => p.income > 0 || p.expense > 0)}
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="flex items-end gap-1 h-48">
				{#each points as point}
					<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end">
						<div class="w-full flex gap-0.5 items-end flex-1">
							<div class="flex-1 bg-phosphor rounded-t" style="height: {(point.income / maxValue) * 100}%"></div>
							<div class="flex-1 bg-debit rounded-t" style="height: {(point.expense / maxValue) * 100}%"></div>
						</div>
						<span class="text-[10px] text-dim">{point.month.slice(5)}</span>
					</div>
				{/each}
			</div>
			<div class="flex gap-4 mt-3 text-xs text-dim">
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-phosphor"></span> {m.reports_income()}</span>
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-debit"></span> {m.reports_expense()}</span>
			</div>
		</div>

		<div class="bg-tape rounded-lg border border-line divide-y divide-line">
			{#each points as point}
				<div class="p-3 flex items-center justify-between text-sm">
					<span class="text-dim">{point.month}</span>
					<div class="flex gap-4 figures">
						<span class="text-phosphor">{formatCurrency(point.income, settings.currency, settings.locale)}</span>
						<span class="text-debit">{formatCurrency(point.expense, settings.currency, settings.locale)}</span>
						<span class="{point.net >= 0 ? 'text-phosphor' : 'text-debit'}">{formatCurrency(point.net, settings.currency, settings.locale)}</span>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_trend_empty()}</p>
		</div>
	{/if}
</div>
