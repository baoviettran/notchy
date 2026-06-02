<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import TransactionForm from '$lib/components/forms/TransactionForm.svelte';
	import FrequentTransactions from '$lib/components/sections/FrequentTransactions.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	let recentTxns = $derived(transactions.items.slice(0, 5));
	let totalAssets = $derived(accounts.assets.reduce((s, a) => s + a.balance, 0));
	let totalLiabilities = $derived(accounts.liabilities.reduce((s, a) => s + Math.abs(a.balance), 0));
	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let totalSpent = $derived(budgets.items.reduce((s, b) => s + b.spent, 0));
	let budgetPct = $derived(totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 100) : 0);

	onMount(async () => {
		await Promise.all([accounts.load(), budgets.load(), transactions.load({ limit: 5 }), goals.load()]);
	});
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

	<!-- Budget Snapshot -->
	<a href="/budgets" class="block bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3 hover:border-zinc-300 transition-colors">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">This Month</h2>
			<span class="text-xs text-zinc-400">{budgets.month}</span>
		</div>
		{#if budgets.hasAllocations}
			<div class="flex items-baseline gap-2">
				<span class="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(totalSpent, settings.currency, settings.locale)}</span>
				<span class="text-sm text-zinc-500">/ {formatCurrency(totalAllocated, settings.currency, settings.locale)}</span>
				<span class="ml-auto text-sm text-zinc-500">{budgetPct}%</span>
			</div>
			<Progress value={budgetPct} max={100} />
			{#each budgets.items as b}
				<div class="flex items-center justify-between text-xs text-zinc-500">
					<span>{b.type_id.replace('bucket_', '')}</span>
					<span class="tabular-nums">{formatCurrency(b.spent, settings.currency, settings.locale)} / {formatCurrency(b.allocated, settings.currency, settings.locale)}</span>
				</div>
			{/each}
		{:else}
			<p class="text-sm text-zinc-400">No budget set. <a href="/budgets" class="text-emerald-600 hover:underline">Set up budget</a></p>
		{/if}
	</a>

	<!-- Inline Transaction Form -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">+ Add transaction</h2>
		<TransactionForm mode="quick" onclose={() => {}} onsave={async () => { await transactions.load({ limit: 5 }); }} />
	</div>

	<!-- Frequent Transactions -->
	<FrequentTransactions />

	<!-- Recent Transactions -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">Recent</h2>
			<a href="/transactions" class="text-xs text-emerald-600 hover:underline">View all →</a>
		</div>
		{#if recentTxns.length === 0}
			<div class="text-center py-8 text-zinc-400">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">No transactions yet.</p>
			</div>
		{:else}
			<div class="divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each recentTxns as tx}
					<div class="py-2 flex items-center justify-between">
						<div>
							<span class="text-sm text-zinc-900 dark:text-zinc-50">{tx.payee || tx.kind}</span>
							<span class="text-xs text-zinc-400 ml-2">{tx.date}</span>
						</div>
						<span class="text-sm tabular-nums {tx.kind === 'expense' ? 'text-red-500' : tx.kind === 'income' ? 'text-emerald-500' : 'text-zinc-500'}">
							{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Goals + Net Position -->
	<div class="grid md:grid-cols-2 gap-4">
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Goals</h2>
			{#if goals.dashboard.length === 0}
				<p class="text-sm text-zinc-400">No goals yet. <a href="/goals" class="text-emerald-600 hover:underline">Create one</a></p>
			{:else}
				{#each goals.dashboard as g}
					<div class="flex items-center justify-between text-sm py-1">
						<span class="text-zinc-900 dark:text-zinc-50">{g.name}</span>
						<span class="text-zinc-500">{g.progress_pct}%</span>
					</div>
				{/each}
			{/if}
			<a href="/goals" class="text-xs text-emerald-600 hover:underline mt-2 inline-block">View all →</a>
		</div>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Net Position</h2>
			<div class="space-y-1">
				<div class="flex justify-between text-sm"><span class="text-zinc-600 dark:text-zinc-400">Assets</span><span class="text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(totalAssets, settings.currency, settings.locale)}</span></div>
				<div class="flex justify-between text-sm"><span class="text-zinc-600 dark:text-zinc-400">Liabilities</span><span class="text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(totalLiabilities, settings.currency, settings.locale)}</span></div>
			</div>
			<a href="/accounts" class="text-xs text-emerald-600 hover:underline mt-2 inline-block">View accounts →</a>
		</div>
	</div>
</div>
