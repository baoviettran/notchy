<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { getComparison } from '$lib/db/repos/reports';
	import type { CompareRow } from '$lib/db/repos/reports';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import * as m from '$lib/paraglide/messages';

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
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_title()}</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_overview()}</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-dim hover:bg-line/40">{m.reports_trend()}</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md bg-phosphor/15 text-phosphor font-medium">{m.reports_compare()}</a>
		</div>
	</div>

	<div class="flex items-center gap-4">
		<input type="month" bind:value={monthA} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<span class="text-dim">{m.reports_vs()}</span>
		<input type="month" bind:value={monthB} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			{m.reports_include_adjustments()}
		</label>
	</div>

	{#if rows.length > 0}
		<div class="bg-tape rounded-lg border border-line overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-line text-dim text-xs">
						<th class="text-left p-3 font-medium">{m.reports_category()}</th>
						<th class="text-right p-3 font-medium">{monthA}</th>
						<th class="text-right p-3 font-medium">{monthB}</th>
						<th class="text-right p-3 font-medium">{m.reports_change()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-line">
					{#each rows as row}
						<tr>
							<td class="p-3 text-ledger">{row.name}</td>
							<td class="p-3 text-right figures text-dim">{formatCurrency(row.month_a, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right figures text-dim">{formatCurrency(row.month_b, settings.currency, settings.locale)}</td>
							<td class="p-3 text-right figures {row.change > 0 ? 'text-debit' : row.change < 0 ? 'text-phosphor' : 'text-dim'}">
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
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_compare_empty()}</p>
		</div>
	{/if}
</div>
