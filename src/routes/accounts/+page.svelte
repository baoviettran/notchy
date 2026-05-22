<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	onMount(() => accounts.load());
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Accounts</h1>
		<Button size="sm">+ Add account</Button>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Assets</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No asset accounts yet.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each accounts.assets as acc}
					<a href="/accounts/{acc.id}" class="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{acc.name}</div>
							<div class="text-xs text-zinc-500">{acc.type}</div>
						</div>
						<span class="text-sm tabular-nums text-zinc-900 dark:text-zinc-50">{formatCurrency(acc.balance, settings.currency, settings.locale)}</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Liabilities</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No liability accounts yet.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each accounts.liabilities as acc}
					<a href="/accounts/{acc.id}" class="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{acc.name}</div>
							<div class="text-xs text-zinc-500">{acc.type}</div>
						</div>
						<span class="text-sm tabular-nums text-red-500">{formatCurrency(Math.abs(acc.balance), settings.currency, settings.locale)}</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>
