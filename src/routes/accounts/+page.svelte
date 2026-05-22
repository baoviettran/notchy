<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Accounts</h1>
		<Button size="sm">+ Add account</Button>
	</div>

	<!-- Assets -->
	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Assets</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No asset accounts yet.</p>
		</div>
	</section>

	<!-- Liabilities -->
	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Liabilities</h2>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
			<p class="text-sm">No liability accounts yet.</p>
		</div>
	</section>
</div>
