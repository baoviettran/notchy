<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';

	interface FrequentTx { payee: string; tag_id: string | null; account_id: string; amount: number; kind: string; count: number }

	let items = $state<FrequentTx[]>([]);

	onMount(async () => {
		const db = await getDb();
		const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
		items = await db.query<FrequentTx>(`
			SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count
			FROM transactions
			WHERE deleted_at IS NULL AND date >= ? AND payee IS NOT NULL AND kind IN ('expense', 'income')
			GROUP BY payee, tag_id, account_id
			ORDER BY count DESC, date DESC
			LIMIT 5
		`, [thirtyDaysAgo]);
	});

	async function repeat(item: FrequentTx) {
		await transactions.create({
			kind: item.kind as any,
			date: new Date().toISOString().split('T')[0],
			amount: item.amount,
			account_id: item.account_id,
			tag_id: item.tag_id ?? undefined
		});
		toast.show(`Saved · ${item.payee} · ${formatCurrency(item.amount, settings.currency, settings.locale)}`, {
			action: 'UNDO', duration: 5000,
			onaction: async () => {
				// Undo last created — simplified: delete most recent
				const db = await getDb();
				const last = await db.query<{ id: string }>(`SELECT id FROM transactions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`);
				if (last[0]) { await transactions.delete(last[0].id); }
			}
		});
	}
</script>

{#if items.length >= 3}
	<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Frequent</h2>
		<div class="flex gap-2 overflow-x-auto pb-1">
			{#each items as item}
				<button
					onclick={() => repeat(item)}
					class="shrink-0 w-24 p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-emerald-400 transition-colors text-center"
				>
					<div class="text-xs font-medium text-zinc-900 dark:text-zinc-50 truncate">{item.payee}</div>
					<div class="text-xs text-zinc-500 tabular-nums mt-1">{formatCurrency(item.amount, settings.currency, settings.locale)}</div>
				</button>
			{/each}
		</div>
	</div>
{/if}
