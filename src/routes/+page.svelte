<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import FrequentTransactions from '$lib/components/sections/FrequentTransactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency, formatNumber } from '$lib/utils/currency';

	let recentTxns = $derived(transactions.items.slice(0, 6));
	let totalAssets = $derived(accounts.assets.reduce((s, a) => s + a.balance, 0));
	let totalLiabilities = $derived(accounts.liabilities.reduce((s, a) => s + Math.abs(a.balance), 0));
	let netPosition = $derived(totalAssets - totalLiabilities);
	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let totalSpent = $derived(budgets.items.reduce((s, b) => s + b.spent, 0));
	let budgetPct = $derived(totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0);

	// This-month net flow from recent visible transactions (income − expense),
	// shown as a directional delta beside the net figure.
	let monthFlow = $derived(
		transactions.items
			.filter((t) => t.kind === 'income' || t.kind === 'expense')
			.reduce((s, t) => s + (t.kind === 'income' ? t.amount : -t.amount), 0)
	);

	// The net figure stands alone — a single VFD readout. A ladder of
	// magnitude ticks only crowded it without encoding anything the number
	// doesn't already say.
	// Human-readable fallback for transactions without a payee — name the entry
	// by what it is to the person reading the list, never the raw system kind.
	const KIND_LABELS: Record<string, string> = {
		expense: 'Expense',
		income: 'Income',
		transfer: 'Transfer',
		refund: 'Refund',
		adjustment: 'Opening balance'
	};
	function labelFor(kind: string): string {
		return KIND_LABELS[kind] ?? kind;
	}

	onMount(async () => {
		await Promise.all([accounts.load(), budgets.load(), transactions.load({ limit: 5 }), goals.load()]);
	});
</script>

<div class="space-y-5">
	<header class="flex items-center justify-between">
		<h1 class="plate">Dashboard</h1>
		<span class="plate">{budgets.month}</span>
	</header>

	<!-- SIGNATURE: net position as a VFD readout. -->
	<section class="surface rounded-lg p-5 md:p-6 relative overflow-hidden">
		<div class="flex items-center justify-between mb-4">
			<h2 class="plate">Net position</h2>
			<a href="/accounts" class="plate hover:text-ledger transition-colors">Accounts →</a>
		</div>

		<div class="min-w-0">
			<div class="figures-glow text-4xl md:text-5xl leading-none break-all">
				{formatCurrency(netPosition, settings.currency, settings.locale)}
			</div>
			<div class="mt-3 flex items-center gap-2 text-sm">
				<span class="figures {monthFlow >= 0 ? 'text-phosphor' : 'text-debit'}">
					{monthFlow >= 0 ? '▲' : '▼'} {formatNumber(Math.abs(monthFlow), settings.locale)}
				</span>
				<span class="text-dim">this month's flow</span>
			</div>
		</div>

		<div class="mt-5 pt-4 border-t border-line grid grid-cols-2 gap-4 text-sm">
			<div>
				<p class="plate mb-1">Assets</p>
				<p class="figures text-ledger">{formatCurrency(totalAssets, settings.currency, settings.locale)}</p>
			</div>
			<div>
				<p class="plate mb-1">Liabilities</p>
				<p class="figures text-debit">{formatCurrency(totalLiabilities, settings.currency, settings.locale)}</p>
			</div>
		</div>
	</section>

	<!-- THIS MONTH: segmented budget meter. -->
	<section class="surface rounded-lg p-5">
		<div class="flex items-center justify-between mb-3">
			<h2 class="plate">This month · spent / budget</h2>
			<a href="/budgets" class="plate hover:text-ledger transition-colors">Budgets →</a>
		</div>
		{#if budgets.hasAllocations}
			<div class="flex items-baseline gap-3 mb-3">
				<span class="figures-glow text-2xl leading-none">{formatCurrency(totalSpent, settings.currency, settings.locale)}</span>
				<span class="text-sm text-dim figures">/ {formatCurrency(totalAllocated, settings.currency, settings.locale)}</span>
				<span class="ml-auto plate">{budgetPct}%</span>
			</div>
			<Progress value={budgetPct} max={100} />
			<div class="mt-4 space-y-1.5">
				{#each budgets.items.slice(0, 4) as b}
					<div class="flex items-center justify-between text-xs">
						<span class="text-dim">{b.type_id.replace('bucket_', '')}</span>
						<span class="figures text-ledger">{formatCurrency(b.spent, settings.currency, settings.locale)} <span class="text-dim">/ {formatCurrency(b.allocated, settings.currency, settings.locale)}</span></span>
					</div>
				{/each}
			</div>
		{:else}
			<!-- Empty budget: show the meter skeleton so the card teaches what budgeting
			     looks like here, instead of going inert. -->
			<Progress value={0} max={100} />
			<div class="mt-4 flex items-center justify-between text-sm">
				<p class="text-dim">No budget set for {budgets.month}.</p>
				<a href="/budgets" class="text-phosphor hover:underline">Set up budget →</a>
			</div>
		{/if}
	</section>

	<!-- QUICK ENTRY: the keypad. -->
	<section class="surface rounded-lg p-5">
		<h2 class="plate mb-3">Quick entry</h2>
		<TransactionForm mode="quick" onclose={() => {}} onsave={async () => { await transactions.load({ limit: 5 }); }} />
	</section>

	<FrequentTransactions />

	<!-- RECENT: the ledger tape. -->
	<section class="surface rounded-lg overflow-hidden">
		<div class="flex items-center justify-between px-5 pt-4 pb-3">
			<h2 class="plate">Recent</h2>
			<a href="/transactions" class="plate hover:text-ledger transition-colors">View all →</a>
		</div>
		{#if recentTxns.length === 0}
			<div class="px-5 pb-6 pt-2 text-dim">
				<p class="figures-glow text-xl mb-1">▮▯▯▯</p>
				<p class="text-sm">No transactions yet. Press <kbd class="figures text-phosphor">N</kbd> or tap + to log the first.</p>
			</div>
		{:else}
			<ul class="divide-y divide-line border-t border-line">
				{#each recentTxns as tx}
					<li class="px-5 py-3 flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm text-ledger truncate">{tx.payee || labelFor(tx.kind)}</p>
							<p class="plate mt-0.5">{tx.date}</p>
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
				<h2 class="plate">Goals</h2>
				<a href="/goals" class="plate hover:text-ledger transition-colors">View all →</a>
			</div>
			<div class="space-y-3">
				{#each goals.dashboard.slice(0, 3) as g}
					<div>
						<div class="flex items-center justify-between text-sm mb-1">
							<span class="text-ledger">{g.name}</span>
							<span class="figures text-dim">{g.progress_pct}%</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" segments={16} />
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
