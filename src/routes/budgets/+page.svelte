<script lang="ts">
	import { onMount } from 'svelte';
	import Progress from '$lib/components/primitives/Progress.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import { budgets } from '$lib/stores/budgets.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import { parseAmount } from '$lib/utils/number_parse';

	let editing = $state<string | null>(null);
	let editValue = $state('');

	onMount(async () => { await categories.load(); await budgets.load(); });

	function bucketName(typeId: string): string {
		return categories.buckets.find((b) => b.id === typeId)?.name ?? typeId;
	}

	function prevMonth() {
		const [y, m] = budgets.month.split('-').map(Number);
		const d = new Date(y, m - 2, 1);
		budgets.load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	function nextMonth() {
		const [y, m] = budgets.month.split('-').map(Number);
		const d = new Date(y, m, 1);
		budgets.load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
	}

	function startEdit(typeId: string, current: number) {
		editing = typeId;
		editValue = current > 0 ? String(current) : '';
	}

	async function saveEdit(typeId: string) {
		try {
			const parsed = editValue.trim() ? parseAmount(editValue, settings.locale) : 0;
			await budgets.setAllocation(typeId, parsed);
			toast.show('Budget updated.');
			editing = null;
		} catch {
			toast.show('Invalid amount.');
		}
	}

	const budgetableBuckets = $derived(categories.buckets.filter((b) => b.budgetable));

	function getBudget(typeId: string) {
		return budgets.items.find((b) => b.type_id === typeId);
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Budgets</h1>
		<div class="flex items-center gap-2 text-sm">
			<button onclick={prevMonth} class="p-1 text-zinc-500 hover:text-zinc-900">◀</button>
			<span class="font-medium text-zinc-900 dark:text-zinc-50 tabular-nums">{budgets.month}</span>
			<button onclick={nextMonth} class="p-1 text-zinc-500 hover:text-zinc-900">▶</button>
		</div>
	</div>

	{#if !budgets.hasAllocations}
		<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center justify-between">
			<p class="text-sm text-amber-800 dark:text-amber-200">No budget set for this month.</p>
			<Button size="sm" variant="secondary" onclick={() => budgets.copyFromPrevious()}>Copy from previous</Button>
		</div>
	{/if}

	<div class="space-y-4">
		{#each budgetableBuckets as bucket}
			{@const b = getBudget(bucket.id)}
			{@const allocated = b?.allocated ?? 0}
			{@const spent = b?.spent ?? 0}
			{@const remaining = allocated - spent}
			{@const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{bucket.name}</h3>
					{#if editing === bucket.id}
						<div class="flex gap-2 items-center">
							<input
								bind:value={editValue}
								onkeydown={(e) => { if (e.key === 'Enter') saveEdit(bucket.id); if (e.key === 'Escape') editing = null; }}
								placeholder="0"
								class="w-32 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-right tabular-nums"
							/>
							<button onclick={() => saveEdit(bucket.id)} class="text-xs text-emerald-600">✓</button>
							<button onclick={() => editing = null} class="text-xs text-zinc-400">✕</button>
						</div>
					{:else}
						<button onclick={() => startEdit(bucket.id, allocated)} class="text-xs text-zinc-500 hover:text-emerald-600 tabular-nums">
							{formatCurrency(spent, settings.currency, settings.locale)} / {formatCurrency(allocated, settings.currency, settings.locale)}
						</button>
					{/if}
				</div>
				<Progress value={pct} max={100} size="sm" />
				<div class="flex justify-between text-xs text-zinc-400">
					<span>{pct}% used</span>
					<span>{formatCurrency(remaining, settings.currency, settings.locale)} remaining</span>
				</div>
			</div>
		{/each}
	</div>
</div>
