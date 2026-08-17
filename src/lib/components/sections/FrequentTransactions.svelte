<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import type { FrequentTx } from '$lib/db/client';

	let items = $state<FrequentTx[]>([]);

	onMount(async () => {
		const db = getDb();
		const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
		items = await db.transactions.getFrequent(thirtyDaysAgo);
	});

	async function repeat(item: FrequentTx) {
		const newId = await transactions.create({
			kind: item.kind as any,
			date: new Date().toISOString().split('T')[0],
			amount: item.amount,
			account_id: item.account_id,
			tag_id: item.tag_id ?? undefined
		});
		toast.show(`Saved · ${item.payee} · ${formatCurrency(item.amount, settings.currency, settings.locale)}`, {
			action: 'UNDO', duration: 5000,
			onaction: async () => {
				// Delete the exact row this repeat created — never "most recent",
				// which could be a different transaction created after this one.
				await transactions.delete(newId);
			}
		});
	}
</script>

{#if items.length >= 3}
	<section class="surface rounded-lg p-5">
		<h2 class="plate mb-3">Repeat · last 30 days</h2>
		<div class="flex gap-2 overflow-x-auto pb-1">
			{#each items as item}
				<button
					onclick={() => repeat(item)}
					class="shrink-0 w-28 p-2.5 rounded-md border border-line bg-ink hover:border-phosphor/60 transition-colors text-left"
				>
					<div class="text-xs text-ledger truncate">{item.payee}</div>
					<div class="figures text-xs text-phosphor mt-1">{formatCurrency(item.amount, settings.currency, settings.locale)}</div>
				</button>
			{/each}
		</div>
	</section>
{/if}
