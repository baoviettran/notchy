<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Categories</h1>
		<Button size="sm">+ Add tag</Button>
	</div>

	{#each ['Essentials', 'Learning & Entertainment', 'Saving & Investment', 'Adjustments'] as bucket}
		<section>
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">{bucket}</h2>
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
				<p class="text-sm text-zinc-400">No custom tags yet.</p>
			</div>
		</section>
	{/each}
</div>
