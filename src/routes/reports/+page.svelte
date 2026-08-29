<script lang="ts">
	import { getDb } from '$lib/db';
	import type { OverviewReport } from '$lib/db/client';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import TapeLine from '$lib/components/reports/TapeLine.svelte';
	import AdjustmentsToggle from '$lib/components/reports/AdjustmentsToggle.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { fmtReport } from '$lib/utils/report-format';
	import { mapError } from '$lib/utils/errors';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let report = $state<OverviewReport | null>(null);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let includeAdjustments = $state(false);

	let totalSpending = $derived(report?.spending_by_bucket.reduce((s, b) => s + b.total, 0) ?? 0);

	function currentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	async function load() {
		error = null;
		try {
			const db = getDb();
			report = await db.reports.getOverview(currentMonth(), includeAdjustments);
			loaded = true;
		} catch (e) {
			error = mapError(e);
		}
	}

	$effect(() => { includeAdjustments; load(); });
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.reports_overview()}</h1>

	<!-- The nav owns its band: seven tabs wrapping beside the title turned
	     every reports header into a ragged block. -->
	<ReportsNav />

	<AdjustmentsToggle bind:checked={includeAdjustments} />

	{#if error}
		<ErrorState description={error} onRetry={load} />
	{:else if !loaded}
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

			<TapeLine label={m.reports_income()} amount={fmtReport(report.total_income, settings.currency, settings.locale)} tone="phosphor" variant="subtotal" />

			<div class="mt-2">
				<p class="plate mb-1">{m.reports_expenses()}</p>
				{#each report.spending_by_bucket as b (b.name)}
					<TapeLine label={b.name} amount={fmtReport(b.total, settings.currency, settings.locale)} tone="ledger" title={formatCurrency(b.total, settings.currency, settings.locale)} />
				{/each}
				<TapeLine label={m.reports_subtotal()} amount={fmtReport(report.total_expense, settings.currency, settings.locale)} tone="debit" variant="subtotal" />
			</div>

			<TapeLine
				label={m.reports_net_cash_flow()}
				amount={fmtReport(report.net_cash_flow, settings.currency, settings.locale)}
				tone={report.net_cash_flow >= 0 ? 'phosphor' : 'debit'}
				variant="total"
			/>
		</section>

		{#if report.top_categories.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_categories()}</h2>
				{#each report.top_categories as c}
					<TapeLine label={c.name} amount={fmtReport(c.total, settings.currency, settings.locale)} tone="ledger" title={formatCurrency(c.total, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.top_transactions.length > 0}
			<section class="surface rounded-lg p-4">
				<h2 class="plate mb-3">{m.reports_top_transactions()}</h2>
				{#each report.top_transactions as tx}
					<!-- Negative sign owned here, not by the caller's data: a refund
					     surfacing as a top transaction can't produce "−−". -->
					<TapeLine label={tx.payee || m.reports_no_payee()} amount={fmtReport(-Math.abs(tx.amount), settings.currency, settings.locale)} tone="debit" title={formatCurrency(tx.amount, settings.currency, settings.locale)} />
				{/each}
			</section>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<EmptyState message={m.reports_empty()} glyph="register" title={m.empty_title_reports()}>
			{#snippet action()}
				<a href="/transactions" class="inline-flex items-center justify-center min-h-9 px-3 text-sm font-medium pointer-coarse:min-h-11 rounded-md border border-dim bg-tape text-ledger hover:border-ledger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor">{m.layout_add_transaction()}</a>
			{/snippet}
		</EmptyState>
		{/if}
	{/if}
</div>
