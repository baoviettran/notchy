<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { getOverview } from '$lib/db/repos/reports';
	import type { OverviewReport } from '$lib/db/repos/reports';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import DonutChart from '$lib/components/charts/DonutChart.svelte';

	let report = $state<OverviewReport | null>(null);
	let includeAdjustments = $state(false);

	const bucketColors: Record<string, string> = {
		Essentials: '#f59e0b', 'Learning & Entertainment': '#8b5cf6',
		'Saving & Investment': '#10b981', Adjustments: '#64748b'
	};

	let donutData = $derived(
		report?.spending_by_bucket.map((b) => ({
			label: b.name, value: b.total, color: bucketColors[b.name] ?? '#94a3b8'
		})) ?? []
	);

	function currentMonth() {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	async function load() {
		const db = await getDb();
		report = await getOverview(db, currentMonth(), includeAdjustments);
	}

	onMount(load);
	$effect(() => { includeAdjustments; load(); });
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Reports</h1>
		<div class="flex gap-2 text-sm">
			<a href="/reports" class="px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium">Overview</a>
			<a href="/reports/trend" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Trend</a>
			<a href="/reports/compare" class="px-3 py-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Compare</a>
		</div>
	</div>

	<label class="flex items-center gap-2 text-sm text-zinc-500">
		<input type="checkbox" bind:checked={includeAdjustments} class="rounded" />
		Include adjustments
	</label>

	{#if report}
		<div class="grid md:grid-cols-3 gap-4">
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<p class="text-xs text-zinc-500">Income</p>
				<p class="text-2xl font-semibold text-emerald-600 tabular-nums">{formatCurrency(report.total_income, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<p class="text-xs text-zinc-500">Expenses</p>
				<p class="text-2xl font-semibold text-red-500 tabular-nums">{formatCurrency(report.total_expense, settings.currency, settings.locale)}</p>
			</div>
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<p class="text-xs text-zinc-500">Net Cash Flow</p>
				<p class="text-2xl font-semibold tabular-nums {report.net_cash_flow >= 0 ? 'text-emerald-600' : 'text-red-500'}">{formatCurrency(report.net_cash_flow, settings.currency, settings.locale)}</p>
			</div>
		</div>

		{#if report.spending_by_bucket.length > 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Spending by Bucket</h2>
				<DonutChart data={donutData} />
				<div class="space-y-2 mt-4">
					{#each report.spending_by_bucket as b}
						<div class="flex items-center justify-between text-sm">
							<span class="text-zinc-900 dark:text-zinc-50">{b.name}</span>
							<span class="tabular-nums text-zinc-600 dark:text-zinc-400">{formatCurrency(b.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_categories.length > 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Top Categories</h2>
				<div class="space-y-2">
					{#each report.top_categories as c}
						<div class="flex items-center justify-between text-sm">
							<span class="text-zinc-900 dark:text-zinc-50">{c.name}</span>
							<span class="tabular-nums text-zinc-600 dark:text-zinc-400">{formatCurrency(c.total, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.top_transactions.length > 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Top Transactions</h2>
				<div class="space-y-2">
					{#each report.top_transactions as tx}
						<div class="flex items-center justify-between text-sm">
							<span class="text-zinc-900 dark:text-zinc-50">{tx.payee || 'No payee'}</span>
							<span class="tabular-nums text-red-500">{formatCurrency(tx.amount, settings.currency, settings.locale)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if report.spending_by_bucket.length === 0 && report.top_transactions.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No data for this month. Add transactions to see reports.</p>
			</div>
		{/if}
	{/if}
</div>
