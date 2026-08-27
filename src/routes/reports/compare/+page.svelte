<script lang="ts">
	import { getDb } from '$lib/db';
	import type { CompareRow } from '$lib/db/client';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { mapError } from '$lib/utils/errors';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let rows = $state<CompareRow[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let includeAdjustments = $state(false);

	// The ledger's own minus (−), never Intl's hyphen: sign is a glyph in
	// this system, paired with tone so color never carries it alone.
	function fmt(amount: number): string {
		const magnitude = Math.abs(amount);
		const figure = isLongCurrency(magnitude, settings.currency, settings.locale)
			? formatCurrencyCompact(magnitude, settings.currency, settings.locale)
			: formatCurrency(magnitude, settings.currency, settings.locale);
		return (amount < 0 ? '−' : '') + figure;
	}

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
		error = null;
		try {
			const db = getDb();
			rows = await db.reports.getComparison(monthA, monthB, includeAdjustments);
			loaded = true;
		} catch (e) {
			error = mapError(e);
		}
	}

	$effect(() => { monthA; monthB; includeAdjustments; load(); });

	let totalA = $derived(rows.reduce((s, r) => s + r.month_a, 0));
	let totalB = $derived(rows.reduce((s, r) => s + r.month_b, 0));
	let totalChange = $derived(totalB - totalA);
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_title()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<input type="month" bind:value={monthA} aria-label={m.reports_month_from()} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<span class="text-dim">{m.reports_vs()}</span>
		<input type="month" bind:value={monthB} aria-label={m.reports_month_to()} class="px-2 py-1 text-sm rounded border border-line bg-ink text-ledger" />
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			{m.reports_include_adjustments()}
		</label>
	</div>

	{#if error}
		<ErrorState description={error} onRetry={load} />
	{:else if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={6} />
		</div>
	{:else if rows.length > 0}
		<!-- Two months side by side on one tape; the change column wears Δ
		     and closes with a ruled grand total. -->
		<section class="surface rounded-lg overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-dashed border-line/60">
						<th scope="col" class="text-left p-3 plate font-normal">{m.reports_category()}</th>
						<th scope="col" class="text-right p-3 plate font-normal">{monthA}</th>
						<th scope="col" class="text-right p-3 plate font-normal">{monthB}</th>
						<th scope="col" class="text-right p-3 plate font-normal">Δ {m.reports_change()}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-line/40">
					{#each rows as row (row.name)}
						<tr>
							<td class="p-3 text-ledger truncate max-w-[10rem] md:max-w-none">{row.name}</td>
							<td class="p-3 text-right figures text-dim" title={formatCurrency(row.month_a, settings.currency, settings.locale)}>{fmt(row.month_a)}</td>
							<td class="p-3 text-right figures text-dim" title={formatCurrency(row.month_b, settings.currency, settings.locale)}>{fmt(row.month_b)}</td>
							<td class="p-3 text-right figures {row.change > 0 ? 'text-debit' : row.change < 0 ? 'text-phosphor' : 'text-dim'}">
								{row.change > 0 ? '+' : ''}{fmt(row.change)}
								{#if row.change_pct !== null}
									<span class="text-xs ml-1">({row.change_pct > 0 ? '+' : ''}{Math.round(row.change_pct)}%)</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr class="border-t-4 border-double border-line">
						<td class="p-3 plate !text-ledger">{m.reports_total()}</td>
						<td class="p-3 text-right figures text-dim">{fmt(totalA)}</td>
						<td class="p-3 text-right figures text-dim">{fmt(totalB)}</td>
						<td class="p-3 text-right figures figures-glow {totalChange > 0 ? 'text-debit' : totalChange < 0 ? 'text-phosphor' : 'text-dim'}">
							{totalChange > 0 ? '+' : ''}{fmt(totalChange)}
						</td>
					</tr>
				</tfoot>
			</table>
		</section>
	{:else}
		<div class="surface rounded-lg p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_compare_empty()}</p>
		</div>
	{/if}
</div>
