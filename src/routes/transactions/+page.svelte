<script lang="ts">
	import Input from '$lib/components/primitives/Input.svelte';

	let search = $state('');
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Transactions</h1>
	</div>

	<!-- Search & Filters -->
	<div class="flex gap-2">
		<div class="flex-1">
			<Input placeholder="Search payee, description..." bind:value={search} />
		</div>
	</div>

	<!-- Transaction List -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
		<div class="text-center py-12 text-zinc-400">
			<p class="text-3xl mb-2">📋</p>
			<p class="text-sm">No transactions yet.</p>
		</div>
	</div>
</div>
