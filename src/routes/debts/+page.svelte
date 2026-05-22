<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Debts</h1>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">I Owe</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No debts. You're debt-free! 🎉</p>
		</div>
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Owed to Me</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No one owes you money.</p>
		</div>
	</section>
</div>
