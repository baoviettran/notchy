<script lang="ts">
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Budgets</h1>
		<span class="text-sm text-zinc-500">May 2026</span>
	</div>

	<!-- Copy from previous prompt -->
	<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center justify-between">
		<p class="text-sm text-amber-800 dark:text-amber-200">No budget set for this month.</p>
		<Button size="sm" variant="secondary">Copy from April</Button>
	</div>

	<!-- Budget cards -->
	<div class="space-y-4">
		{#each ['Essentials', 'Learning & Entertainment', 'Saving & Investment'] as bucket}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{bucket}</h3>
					<span class="text-xs text-zinc-500">0 / 0 VND</span>
				</div>
				<Progress value={0} max={100} size="sm" />
				<p class="text-xs text-zinc-400">No allocation set</p>
			</div>
		{/each}
	</div>
</div>
