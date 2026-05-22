<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	onMount(async () => { await budgets.load(); await categories.load(); });

	function bucketName(typeId: string): string {
		return categories.buckets.find((b) => b.id === typeId)?.name ?? typeId;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Budgets</h1>
		<span class="text-sm text-zinc-500">{budgets.month}</span>
	</div>

	{#if !budgets.hasAllocations}
		<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center justify-between">
			<p class="text-sm text-amber-800 dark:text-amber-200">No budget set for this month.</p>
			<Button size="sm" variant="secondary" onclick={() => budgets.copyFromPrevious()}>Copy from previous</Button>
		</div>
	{/if}

	<div class="space-y-4">
		{#each budgets.items as b}
			{@const pct = b.allocated > 0 ? Math.round((b.spent / b.allocated) * 100) : 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{bucketName(b.type_id)}</h3>
					<span class="text-xs text-zinc-500 tabular-nums">{formatCurrency(b.spent, settings.currency, settings.locale)} / {formatCurrency(b.allocated, settings.currency, settings.locale)}</span>
				</div>
				<Progress value={pct} max={100} size="sm" />
				<div class="flex justify-between text-xs text-zinc-400">
					<span>{pct}% used</span>
					<span>{formatCurrency(b.remaining, settings.currency, settings.locale)} remaining</span>
				</div>
			</div>
		{/each}
		{#if budgets.items.length === 0 && budgets.hasAllocations}
			<p class="text-sm text-zinc-400 text-center py-4">No budgetable buckets found.</p>
		{/if}
	</div>
</div>
