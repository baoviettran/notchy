<script lang="ts">
	import { onMount } from 'svelte';
	import { debts } from '$lib/stores/debts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	onMount(() => debts.load());
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Debts</h1>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">I Owe</h2>
		{#if debts.i_owe.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No debts. You're debt-free! 🎉</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each debts.i_owe as d}
					<div class="p-4 flex items-center justify-between">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.counterparty}</div>
							<div class="text-xs text-zinc-500">{d.name}</div>
						</div>
						<span class="text-sm tabular-nums text-red-500">{formatCurrency(Math.abs(d.balance), settings.currency, settings.locale)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Owed to Me</h2>
		{#if debts.owed_to_me.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No one owes you money.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each debts.owed_to_me as d}
					<div class="p-4 flex items-center justify-between">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.counterparty}</div>
							<div class="text-xs text-zinc-500">{d.name}</div>
						</div>
						<span class="text-sm tabular-nums text-emerald-600">{formatCurrency(d.balance, settings.currency, settings.locale)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
