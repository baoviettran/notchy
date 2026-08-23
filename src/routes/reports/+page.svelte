<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import type { OverviewReport } from '$lib/db/client';
	import { settings } from '$lib/stores/settings.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import TapeLine from '$lib/components/reports/TapeLine.svelte';
	import DonutChart from '$lib/components/charts/DonutChart.svelte';
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { seriesColor } from '$lib/utils/palette';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let report = $state<OverviewReport | null>(null);
	let loaded = $state(false);
	let includeAdjustments = $state(false);

	// Stable per-bucket ordering so a bucket keeps one color across months.
	const bucketRank = ['Essentials', 'Learning & Entertainment', 'Saving & Investment', 'Adjustments'];

	function fmt(amount: number): string {
		return isLongCurrency(amount, settings.currency, settings.locale)
			? formatCurrencyCompact(amount, settings.currency, settings.locale)
			: formatCurrency(amount, settings.currency, settings.locale);
	}

	let totalSpending = $derived(report?.spending_by_bucket.reduce((s, b) => s + b.total, 0) ?? 0);

	let donutData = $derived(
		report?.spending_by_bucket.map((b) => ({
			label: b.name,
			value: b.total,
			color: seriesColor(bucketRank.indexOf(b.name))
		})) ?? []
	);

	function currentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	async function load() {
		const db = getDb();
		report = await db.reports.getOverview(currentMonth(), includeAdjustments);
		loaded = true;
	}

	onMount(load);
	$effect(() => { includeAdjustments; load(); });
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_title()}</h1>
		<ReportsNav />
	</div>

	<label class="flex items-center gap-2 text-sm text-dim">
		<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
		{m.reports_include_adjustments()}
	</label>

	{#if !loaded}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={6} />
		</div>
	{:else if report}
		<!-- THE STATEMENT: one tape. Income, expense lines with leaders,
		     ruled subtotal, and the net as the machine's grand total. -->
		<section class="surface rounded-lg p-5" aria-label={m.reports_net_cash_flow()}>
			<div class="flex items-baseline justify-between mb-3">
				<span class="plate">{m.reports_overview()} · {currentMonth()}</span>
				<span class="plate">▮▯▯▯</span>
			</div>

			<TapeLine label={m.reports_income()} amount={fmt(report.total_income)} tone="phosphor" variant="subtotal" />

			<div class="mt-2">
				<p class="plate mb-1">{m.reports_expenses()}</p>
				{#each report.spending_by_bucket as b}
					<TapeLine label={b.name} amount={fmt(b.total)} tone="dim" title={formatCurrency(b.total, settings.currency, settings.locale)} />
				{/each}
				{#if report.spending_by_bucket.length === 0}
					<TapeLine label={m.reports_empty()} amount={fmt(0)} tone="dim" />
				{/if}
				<TapeLine label={m.reports_subtotal()} amount={fmt(report.total_expense)} tone="debit" variant="subtotal" />
			</div>

			<TapeLine
				label={m.reports_net_cash_flow()}
				amount={fmt(report.net_cash_flow)}
				tone={report.net_cash_flow >= 0 ? 'phosphor' : 'debit'}
				variant="total"
			/>
		</section>

		{#if report.spending_by_bucket.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_spending_by_bucket()}</h2>
				<DonutChart data={donutData} centerLabel={report ? fmt(totalSpending) : ''} />
			</section>
		{/if}

		{#if report.top_categories.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_categories()}</h2>
				{#each report.top_categories as c}
					<TapeLine label={c.name} amount={fmt(c.total)} tone="dim" title={formatCurrency(c.total, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.top_transactions.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_transactions()}</h2>
				{#each report.top_transactions as tx}
					<TapeLine label={tx.payee || m.reports_no_payee()} amount={'−' + fmt(tx.amount)} tone="debit" title={formatCurrency(tx.amount, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.reports_empty()}</p>
			</div>
		{/if}
	{/if}
</div>
