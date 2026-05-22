<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	onMount(() => goals.load());

	const statusIcons: Record<string, string> = { on_track: '✓', behind: '⚠', ahead: '★', overdue: '⏰', insufficient_data: '…' };
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Goals</h1>
		<Button size="sm">+ Add goal</Button>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Active</h2>
		{#if goals.active.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No active goals. <button class="text-emerald-600 hover:underline">Create your first goal</button></p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each goals.active as g}
					<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{g.name}</span>
							<span class="text-xs">{statusIcons[g.velocity_status] ?? ''} {g.velocity_status.replace('_', ' ')}</span>
						</div>
						<Progress value={g.progress_pct} max={100} size="sm" />
						<div class="flex justify-between text-xs text-zinc-500">
							<span>{formatCurrency(g.current_amount, settings.currency, settings.locale)} / {formatCurrency(g.target_amount, settings.currency, settings.locale)}</span>
							<span>{g.progress_pct}%</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Completed</h2>
		{#if goals.completed.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No completed goals yet.</p>
			</div>
		{:else}
			{#each goals.completed as g}
				<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 flex items-center justify-between text-sm">
					<span class="text-zinc-500">{g.name}</span>
					<span class="text-emerald-600">✓ Complete</span>
				</div>
			{/each}
		{/if}
	</section>
</div>
