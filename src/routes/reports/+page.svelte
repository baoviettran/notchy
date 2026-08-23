<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import type { OverviewReport } from '$lib/db/client';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import DonutChart from '$lib/components/charts/DonutChart.svelte';
	import { seriesColor } from '$lib/utils/palette';
	import * as m from '$lib/paraglide/messages';
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

	let report = $state<OverviewReport | null>(null);
	let includeAdjustments = $state(false);

	// Stable per-bucket ordering so a bucket keeps one color across months.
	const bucketRank = ['Essentials', 'Learning & Entertainment', 'Saving & Investment', 'Adjustments'];

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

	{#if report}
		<div class="grid md:grid-cols-3 gap-4">
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">{m.reports_income()}</p>
				<p class="figures text-2xl text-phosphor">{formatCurrency(report.total_income, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">{m.reports_expenses()}</p>
				<p class="figures text-2xl text-debit">{formatCurrency(report.total_expense, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-tape rounded-lg border border-line p-4">
				<p class="plate mb-1">{m.reports_net_cash_flow()}</p>
				<p class="figures text-2xl {report.net_cash_flow >= 0 ? 'text-phosphor' : 'text-debit'}">{formatCurrency(report.net_cash_flow, settings.currency, settings.locale)}</p>
			</div>
		</div>

		{#if report.spending_by_bucket.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">{m.reports_spending_by_bucket()}</h2>
				<DonutChart data={donutData} centerLabel={report ? formatCurrency(totalSpending, settings.currency, settings.locale) : ''} />
				<div class="space-y-2 mt-4">
					{#each report.spending_by_bucket as b}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{b.name}</span>
							<span class="figures text-dim">{formatCurrency(b.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_categories.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">{m.reports_top_categories()}</h2>
				<div class="space-y-2">
					{#each report.top_categories as c}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{c.name}</span>
							<span class="figures text-dim">{formatCurrency(c.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_transactions.length > 0}
			<div class="bg-tape rounded-lg border border-line p-4">
				<h2 class="plate mb-3">{m.reports_top_transactions()}</h2>
				<div class="space-y-2">
					{#each report.top_transactions as tx}
						<div class="flex items-center justify-between text-sm">
							<span class="text-ledger">{tx.payee || m.reports_no_payee()}</span>
							<span class="figures text-debit">{formatCurrency(tx.amount, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.reports_empty()}</p>
			</div>
		{/if}
	{/if}
</div>
