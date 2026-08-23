<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import type { TrendPoint } from '$lib/db/client';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let points = $state<TrendPoint[]>([]);
	let loaded = $state(false);
	let months = $state(6);
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

	async function load() {
		const db = getDb();
		points = await db.reports.getTrend(months, includeAdjustments);
		loaded = true;
	}

	onMount(load);
	$effect(() => { months; includeAdjustments; load(); });

	let maxValue = $derived(Math.max(...points.map((p) => Math.max(p.income, p.expense)), 1));
	let totalIncome = $derived(points.reduce((s, p) => s + p.income, 0));
	let totalExpense = $derived(points.reduce((s, p) => s + p.expense, 0));
	let totalNet = $derived(totalIncome - totalExpense);
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_title()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<div class="flex items-center gap-4">
		<div class="flex gap-1 text-sm">
			{#each [6, 12, 24] as n}
				<button type="button" onclick={() => months = n}
					class="px-2 py-1 rounded {months === n ? 'bg-phosphor/15 text-phosphor font-medium' : 'text-dim'}"
				>{m.reports_months({ count: n })}</button>
			{/each}
		</div>
		<label class="flex items-center gap-2 text-sm text-dim">
			<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
			{m.reports_include_adjustments()}
		</label>
	</div>

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={5} />
		</div>
	{:else if points.length > 0 && points.some((p) => p.income > 0 || p.expense > 0)}
		<!-- The meter: each month column announces its figures to the title
		     tooltip and to assistive tech — the bars carry no values alone. -->
		<section class="surface rounded-lg border border-line p-4">
			<h2 class="plate mb-3">{m.reports_trend()}</h2>
			<div class="flex items-end gap-1 h-48">
				{#each points as point (point.month)}
					{@const label = point.month + ': ' + m.reports_income() + ' ' + formatCurrency(point.income, settings.currency, settings.locale) + ', ' + m.reports_expense() + ' ' + formatCurrency(point.expense, settings.currency, settings.locale)}
					<button
						type="button"
						aria-label={label}
						title={label}
						class="flex-1 flex flex-col items-center gap-1 h-full justify-end rounded cursor-default focus-visible:bg-line/20"
					>
						<div class="w-full flex gap-0.5 items-end flex-1">
							<div class="flex-1 bg-phosphor rounded-t" style="height: {(point.income / maxValue) * 100}%"></div>
							<div class="flex-1 bg-debit rounded-t" style="height: {(point.expense / maxValue) * 100}%"></div>
						</div>
						<span class="text-[11px] text-dim">{point.month.slice(5)}</span>
					</button>
				{/each}
			</div>
			<div class="flex gap-4 mt-3 text-xs text-dim">
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-phosphor"></span> {m.reports_income()}</span>
				<span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-debit"></span> {m.reports_expense()}</span>
			</div>
		</section>

		<!-- The ledger: one ruled line per month, closed by a grand total. -->
		<section class="surface rounded-lg px-4 py-3" aria-label={m.reports_trend()}>
			<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-4 pb-2 border-b border-dashed border-line/60">
				<span class="plate"></span>
				<span class="plate text-right">{m.reports_income()}</span>
				<span class="plate text-right">{m.reports_expense()}</span>
				<span class="plate text-right">Δ</span>
			</div>
			{#each points as point (point.month)}
				<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-4 py-2 border-b border-line/40 text-sm min-w-0">
					<span class="figures text-dim shrink-0">{point.month}</span>
					<span class="figures text-phosphor text-right" title={formatCurrency(point.income, settings.currency, settings.locale)}>{fmt(point.income)}</span>
					<span class="figures text-debit text-right" title={formatCurrency(point.expense, settings.currency, settings.locale)}>{fmt(point.expense)}</span>
					<span class="figures text-right {point.net >= 0 ? 'text-phosphor' : 'text-debit'}" title={formatCurrency(point.net, settings.currency, settings.locale)}>{fmt(point.net)}</span>
				</div>
			{/each}
			<div class="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-4 pt-2 mt-1 border-t-4 border-double border-line">
				<span class="plate !text-ledger">{m.reports_total()}</span>
				<span class="figures text-phosphor text-right">{fmt(totalIncome)}</span>
				<span class="figures text-debit text-right">{fmt(totalExpense)}</span>
				<span class="figures text-right figures-glow {totalNet >= 0 ? 'text-phosphor' : 'text-debit'}">{fmt(totalNet)}</span>
			</div>
		</section>
	{:else}
		<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim min-h-[200px] flex items-center justify-center">
			<p class="text-sm">{m.reports_trend_empty()}</p>
		</div>
	{/if}
</div>
