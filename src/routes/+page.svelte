<script lang="ts">
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

	<!-- Budget Snapshot -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">This Month</h2>
			<span class="text-xs text-zinc-400">May 2026</span>
		</div>
		<div class="flex items-baseline gap-2">
			<span class="text-2xl font-semibold text-zinc-900 dark:text-zinc-50 tabular-nums">0</span>
			<span class="text-sm text-zinc-500">/ 0 VND</span>
			<span class="ml-auto text-sm text-zinc-500">0%</span>
		</div>
		<Progress value={0} max={100} />
		<p class="text-xs text-zinc-400">No budget set. <a href="/budgets" class="text-emerald-600 hover:underline">Set up budget</a></p>
	</div>

	<!-- Inline Transaction Form -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">+ Add transaction</h2>
		<div class="flex gap-2">
			<div class="flex-1">
				<Input placeholder="Amount (e.g. 50k)" />
			</div>
			<div class="flex-1">
				<Input placeholder="Tag" />
			</div>
			<Button>Save</Button>
		</div>
	</div>

	<!-- Recent Transactions -->
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400">Recent</h2>
			<a href="/transactions" class="text-xs text-emerald-600 hover:underline">View all →</a>
		</div>
		<div class="text-center py-8 text-zinc-400">
			<p class="text-3xl mb-2">📋</p>
			<p class="text-sm">No transactions yet.</p>
			<p class="text-sm mt-1"><button class="text-emerald-600 hover:underline">Add your first one</button></p>
		</div>
	</div>

	<!-- Goals + Net Position -->
	<div class="grid md:grid-cols-2 gap-4">
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Goals</h2>
			<p class="text-sm text-zinc-400">No goals yet. <a href="/goals" class="text-emerald-600 hover:underline">Create your first goal</a></p>
		</div>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Net Position</h2>
			<div class="space-y-1">
				<div class="flex justify-between text-sm"><span class="text-zinc-600 dark:text-zinc-400">Assets</span><span class="text-zinc-900 dark:text-zinc-50 tabular-nums">0 VND</span></div>
				<div class="flex justify-between text-sm"><span class="text-zinc-600 dark:text-zinc-400">Liabilities</span><span class="text-zinc-900 dark:text-zinc-50 tabular-nums">0 VND</span></div>
			</div>
			<a href="/accounts" class="text-xs text-emerald-600 hover:underline mt-2 inline-block">View accounts →</a>
		</div>
	</div>
</div>
