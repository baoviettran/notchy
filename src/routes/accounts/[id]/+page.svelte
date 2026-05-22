<script lang="ts">
	import { page } from '$app/stores';
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Account Detail</h1>
		<div class="flex gap-2">
			<Button size="sm" variant="secondary">Reconcile</Button>
			<Button size="sm" variant="secondary">Edit</Button>
		</div>
	</div>

	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
		<p class="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">0 VND</p>
		<p class="text-sm text-zinc-500">Current balance</p>
	</div>

	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
		<p class="text-sm">No transactions for this account.</p>
	</div>
</div>
