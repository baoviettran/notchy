<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Goals</h1>
		<Button size="sm">+ Add goal</Button>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Active</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No active goals. <button class="text-emerald-600 hover:underline">Create your first goal</button></p>
		</div>
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Completed</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No completed goals yet.</p>
		</div>
	</section>
</div>
