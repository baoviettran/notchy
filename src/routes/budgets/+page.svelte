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
	import * as m from '$lib/paraglide/messages';

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
			const parsed = editValue.trim() ? parseAmount(editValue, settings.locale, settings.currency) : 0;
			await budgets.setAllocation(typeId, parsed);
			toast.show(m.budgets_updated());
			editing = null;
		} catch {
			toast.show(m.validation_invalid_amount());
		}
	}

	const budgetableBuckets = $derived(categories.buckets.filter((b) => b.budgetable));

	function getBudget(typeId: string) {
		return budgets.items.find((b) => b.type_id === typeId);
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.budgets_title()}</h1>
		<div class="flex items-center gap-2 text-sm">
			<button onclick={prevMonth} class="p-1 text-dim hover:text-ledger">◀</button>
			<span class="figures font-medium text-ledger">{budgets.month}</span>
			<button onclick={nextMonth} class="p-1 text-dim hover:text-ledger">▶</button>
		</div>
	</div>

	{#if !budgets.hasAllocations}
		<div class="bg-phosphor/10 border border-phosphor/30 rounded-lg p-4 flex items-center justify-between">
			<p class="text-sm text-phosphor">{m.budgets_no_budget_for_month()}</p>
			<Button size="sm" variant="secondary" onclick={() => budgets.copyFromPrevious()}>{m.budgets_copy_from_previous()}</Button>
		</div>
	{/if}

	<div class="space-y-4">
		{#each budgetableBuckets as bucket}
			{@const b = getBudget(bucket.id)}
			{@const allocated = b?.allocated ?? 0}
			{@const spent = b?.spent ?? 0}
			{@const remaining = allocated - spent}
			{@const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : 0}
			<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-medium text-ledger">{bucket.name}</h3>
					{#if editing === bucket.id}
						<div class="flex gap-2 items-center">
							<input
								bind:value={editValue}
								onkeydown={(e) => { if (e.key === 'Enter') saveEdit(bucket.id); if (e.key === 'Escape') editing = null; }}
								placeholder="0"
								class="figures w-32 px-2 py-1 text-xs rounded border border-line bg-ink text-ledger text-right"
							/>
							<button onclick={() => saveEdit(bucket.id)} class="text-xs text-phosphor">✓</button>
							<button onclick={() => editing = null} class="text-xs text-dim">✕</button>
						</div>
					{:else}
						<button onclick={() => startEdit(bucket.id, allocated)} class="figures text-xs text-dim hover:text-phosphor">
							{formatCurrency(spent, settings.currency, settings.locale)} / {formatCurrency(allocated, settings.currency, settings.locale)}
						</button>
					{/if}
				</div>
				<Progress value={pct} max={100} size="sm" />
				<div class="flex justify-between text-xs text-dim">
					<span>{pct}% {m.budgets_used()}</span>
					<span>{formatCurrency(remaining, settings.currency, settings.locale)} {m.budgets_remaining()}</span>
				</div>
			</div>
		{/each}
	</div>
</div>
