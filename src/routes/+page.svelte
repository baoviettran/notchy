<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import FrequentTransactions from '$lib/components/sections/FrequentTransactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatNumber } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';
	import { labelFor } from '$lib/utils/tx-kind';
	import * as m from '$lib/paraglide/messages';

	// Bucket display names come from the localized catalogue — never the raw
	// bucket_ slug.
	function bucketName(typeId: string): string {
		return categories.buckets.find((b) => b.id === typeId)?.name ?? typeId;
	}

	let isLoading = $derived(transactions.loading || accounts.loading || budgets.loading || goals.loading);
	let storeError = $derived(transactions.error || accounts.error || null);
	function reloadDashboard() {
		void Promise.all([accounts.load(), budgets.load(), transactions.load({ limit: 5 }), goals.load(), transactions.loadMonthFlow()]);
	}

	let recentTxns = $derived(transactions.items.slice(0, 5));
	let totalAssets = $derived(accounts.assets.reduce((s, a) => s + a.balance, 0));
	let totalLiabilities = $derived(accounts.liabilities.reduce((s, a) => s + Math.abs(a.balance), 0));
	let netPosition = $derived(totalAssets - totalLiabilities);
	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let totalSpent = $derived(budgets.items.reduce((s, b) => s + b.spent, 0));
	let budgetPct = $derived(totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0);

// Empty-budget teaching state: a sample month that shows the shape of a
// budget before the user has made one. The amounts are illustrative, scaled
// to a believable magnitude for the user's currency so the example reads in
// their money rather than an abstract unit.
const sampleScale = settings.currency === 'VND' ? 1_000_000 : 100;
const sampleBuckets = [
	{ name: m.dashboard_sample_rent(), spent: 6 * sampleScale, allocated: 6 * sampleScale },
	{ name: m.dashboard_sample_groceries(), spent: 4 * sampleScale, allocated: 6 * sampleScale },
	{ name: m.dashboard_sample_savings(), spent: 3 * sampleScale, allocated: 6 * sampleScale }
];

	let monthFlow = $derived(transactions.monthFlow);

	// The net figure stands alone — a single VFD readout. A ladder of
	// magnitude ticks only crowded it without encoding anything the number
	// doesn't already say.
	// Human-readable fallback for transactions without a payee — name the entry
	// by what it is to the person reading the list, never the raw system kind.
	// (labelFor / KIND_LABELS live in src/lib/utils/tx-kind.ts.)

	onMount(async () => {
		await Promise.all([accounts.load(), budgets.load(), categories.load(), transactions.load({ limit: 5 }), goals.load(), transactions.loadMonthFlow()]);
	});
</script>

<div class="space-y-5">
	{#if isLoading && !storeError}
		<div class="surface rounded-lg p-5">
			<Skeleton lines={4} />
		</div>
	{:else if storeError}
		<ErrorState description={storeError} onRetry={reloadDashboard} />
	{:else}
	<header class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.nav_dashboard()}</h1>
		<span class="plate">{budgets.month}</span>
	</header>

	<!-- SIGNATURE: net position as a VFD readout. -->
	<section class="surface rounded-lg p-5 md:p-6 relative overflow-hidden" data-tour="net">
		<div class="flex items-center justify-between mb-4">
			<h2 class="plate">{m.dashboard_net_position()}</h2>
			<a href="/accounts" class="plate hover:text-ledger transition-colors">{m.dashboard_accounts_link()}</a>
		</div>

		<div class="min-w-0">
			<div class="figures-glow text-4xl md:text-5xl leading-none break-all">
				{formatCurrency(netPosition, settings.currency, settings.locale)}
			</div>
			<div class="mt-3 flex items-center gap-2 text-sm">
				<span class="figures {monthFlow >= 0 ? 'text-phosphor' : 'text-debit'}">
					{monthFlow >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(monthFlow), settings.locale)}
				</span>
				<span class="text-dim">{m.dashboard_month_flow()}</span>
			</div>
		</div>

		<div class="mt-5 pt-4 border-t border-line grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="plate mb-1">{m.dashboard_assets()}</p>
				<p class="figures text-ledger">{formatCurrency(totalAssets, settings.currency, settings.locale)}</p>
			</div>
			<div>
				<p class="plate mb-1">{m.dashboard_liabilities()}</p>
				<p class="figures text-debit">{formatCurrency(totalLiabilities, settings.currency, settings.locale)}</p>
			</div>
		</div>
	</section>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<!-- THIS MONTH: segmented budget meter. -->
		<section class="surface rounded-lg p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="plate">{m.dashboard_this_month()}</h2>
				<a href="/budgets" class="plate hover:text-ledger transition-colors">{m.dashboard_budgets_link()}</a>
			</div>
			{#if budgets.hasAllocations}
				<div class="flex items-baseline gap-3 mb-3">
					<span class="figures-glow text-2xl leading-none">{formatCurrency(totalSpent, settings.currency, settings.locale)}</span>
					<span class="text-sm text-dim figures">/ {formatCurrency(totalAllocated, settings.currency, settings.locale)}</span>
					<span class="ml-auto plate">{budgetPct}%</span>
				</div>
				<Progress value={budgetPct} max={100} label={m.layout_budget()} />
				<div class="mt-4 space-y-1.5">
					{#each budgets.items.slice(0, 4) as b}
						<div class="flex items-center justify-between text-xs">
							<span class="text-dim">{bucketName(b.type_id)}</span>
							<span class="figures text-ledger">{formatCurrency(b.spent, settings.currency, settings.locale)} <span class="text-dim">/ {formatCurrency(b.allocated, settings.currency, settings.locale)}</span></span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-dim">{m.dashboard_no_budget({ month: budgets.month })}</p>
				<p class="mt-1 text-sm text-dim">{m.dashboard_budget_teach()}</p>
				<div class="mt-4 space-y-3">
					{#each sampleBuckets as s}
						<div>
							<div class="flex items-center justify-between text-xs mb-1">
								<span class="text-ledger">{s.name}</span>
								<span class="figures text-ledger">{formatCurrency(s.spent, settings.currency, settings.locale)} <span class="text-dim">/ {formatCurrency(s.allocated, settings.currency, settings.locale)}</span></span>
							</div>
							<Progress value={Math.round((s.spent / s.allocated) * 100)} max={100} size="sm" label={s.name} />
						</div>
					{/each}
				</div>
				<div class="mt-4 text-right">
					<a href="/budgets" class="text-phosphor hover:underline text-sm">{m.dashboard_setup_budget()}</a>
				</div>
			{/if}
		</section>

		<FrequentTransactions />
	</div>

	<!-- RECENT: the ledger tape. -->
	<section class="surface rounded-lg overflow-hidden">
		<div class="flex items-center justify-between px-5 pt-4 pb-3">
			<h2 class="plate">{m.dashboard_recent()}</h2>
			<a href="/transactions" class="plate hover:text-ledger transition-colors">{m.dashboard_view_all()}</a>
		</div>
		{#if recentTxns.length === 0}
			<div class="px-5 pb-2">
				<EmptyState message={m.dashboard_no_txns_yet({ shortcut: 'N' })} icon="▮▯▯▯" />
			</div>
		{:else}
			<ul class="divide-y divide-line border-t border-line">
				{#each recentTxns as tx}
					<li class="px-5 py-3 flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm text-ledger truncate">{tx.payee || labelFor(tx.kind)}</p>
							<p class="plate mt-0.5">{formatDateRelative(tx.date, settings.locale)}</p>
						</div>
						<span class="figures text-sm shrink-0 {tx.kind === 'expense' ? 'text-debit' : tx.kind === 'income' ? 'text-phosphor' : 'text-dim'}">
							{tx.kind === 'expense' ? '−' : tx.kind === 'income' ? '+' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- GOALS -->
	{#if goals.dashboard.length > 0}
		<section class="surface rounded-lg p-5">
			<div class="flex items-center justify-between mb-3">
				<h2 class="plate">{m.nav_goals()}</h2>
				<a href="/goals" class="plate hover:text-ledger transition-colors">{m.dashboard_view_all()}</a>
			</div>
			<div class="space-y-3">
				{#each goals.dashboard.slice(0, 3) as g}
					<div>
						<div class="flex items-center justify-between text-sm mb-1">
							<span class="text-ledger">{g.name}</span>
							<span class="figures text-dim">{g.progress_pct}%</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" segments={16} label={g.name} />
					</div>
				{/each}
			</div>
		</section>
	{/if}
	{/if}
</div>
