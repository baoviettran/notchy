<script lang="ts">
	import { onMount } from 'svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { formatDateRelative } from '$lib/utils/date';

	let search = $state('');

	onMount(() => transactions.load());

	async function onSearch() {
		await transactions.load({ query: search || undefined });
	}
</script>

<div class="space-y-4">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Transactions</h1>

	<div class="flex gap-2">
		<div class="flex-1">
			<Input placeholder="Search payee, description..." bind:value={search} />
		</div>
		<button onclick={onSearch} class="px-3 py-2 text-sm rounded-md bg-emerald-600 text-white">Search</button>
	</div>

	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
		{#if transactions.items.length === 0}
			<div class="text-center py-12 text-zinc-400">
				<p class="text-3xl mb-2">📋</p>
				<p class="text-sm">No transactions found.</p>
			</div>
		{:else}
			{#each transactions.items as tx}
				<div class="p-4 flex items-center justify-between">
					<div>
						<div class="text-sm text-zinc-900 dark:text-zinc-50">{tx.payee || tx.kind}</div>
						<div class="text-xs text-zinc-500">{formatDateRelative(tx.date, settings.locale)}</div>
					</div>
					<span class="text-sm tabular-nums {tx.kind === 'expense' ? 'text-red-500' : tx.kind === 'income' ? 'text-emerald-500' : 'text-zinc-500'}">
						{tx.kind === 'expense' ? '-' : ''}{formatCurrency(tx.amount, settings.currency, settings.locale)}
					</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
