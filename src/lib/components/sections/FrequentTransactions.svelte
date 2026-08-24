<script lang="ts">
	import { onMount } from 'svelte';
	import { getDb } from '$lib/db';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import Money from '$lib/components/reports/Money.svelte';
	import type { FrequentTx } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	let items = $state<FrequentTx[]>([]);
	// A failed frequent-load degrades to the same quiet section as an empty
	// one — the strip is an accelerator, never a required surface — but the
	// rejection must be observed, not swallowed.
	let loadFailed = $state(false);
	// Two-stage stamp: first tap arms the card (preview), second tap commits.
	// A stray thumb can no longer write a real transaction — the worst case
	// is an armed preview that disarms itself after 4 seconds.
	function itemKey(item: FrequentTx): string {
		return [item.payee, item.kind, item.account_id, item.tag_id ?? '', item.amount].join(':');
	}

	let armedKey = $state<string | null>(null);
	let disarmTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		const db = getDb();
		const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0];
		db.transactions.getFrequent(thirtyDaysAgo)
			.then((rows) => (items = rows))
			.catch(() => (loadFailed = true));
		return () => clearTimeout(disarmTimer);
	});

	function armOrRepeat(item: FrequentTx) {
		const key = itemKey(item);
		if (armedKey !== key) {
			armedKey = key;
			clearTimeout(disarmTimer);
			disarmTimer = setTimeout(() => (armedKey = null), 4000);
			return;
		}
		clearTimeout(disarmTimer);
		armedKey = null;
		void repeat(item);
	}

	async function repeat(item: FrequentTx) {
		try {
			const newId = await transactions.create({
				kind: item.kind as any,
				date: new Date().toISOString().split('T')[0],
				amount: item.amount,
				account_id: item.account_id,
				tag_id: item.tag_id ?? undefined
			});
			toast.show(m.frequent_saved_toast({ payee: item.payee ?? '', amount: formatCurrency(item.amount, settings.currency, settings.locale) }), {
				action: m.transactions_undo(), duration: 5000,
				onaction: async () => {
					// Delete the exact row this repeat created — never "most recent",
					// which could be a different transaction created after this one.
					await transactions.delete(newId);
				}
			});
		} catch {
			toast.show(m.frequent_error_toast(), { duration: 4000 });
		}
	}
</script>

{#if !loadFailed}
	<section class="surface rounded-lg p-5">
		<h2 class="plate mb-3">{m.frequent_repeat_header()}</h2>
		{#if items.length >= 3}
			<div class="relative">
				<div class="flex gap-2 overflow-x-auto pb-1" style="scrollbar-width: thin;">
					{#each items as item (itemKey(item))}
						<button
							onclick={() => armOrRepeat(item)}
							aria-pressed={armedKey === itemKey(item)}
							class="shrink-0 w-28 p-2.5 rounded-md border transition-colors text-left
								{armedKey === itemKey(item)
									? 'border-phosphor bg-phosphor/10'
									: 'border-line bg-ink hover:border-phosphor/60'}"
						>
							<div class="text-xs text-ledger truncate">{item.payee}</div>
							<div class="mt-1">
								<Money
									amount={item.amount}
									glyph={item.kind === 'expense' ? '−' : item.kind === 'income' ? '+' : ''}
									tone={item.kind === 'expense' ? 'debit' : item.kind === 'income' ? 'phosphor' : 'dim'}
									size="text-xs"
								/>
							</div>
							{#if armedKey === itemKey(item)}
								<div class="mt-1.5 text-[11px] text-phosphor">{m.frequent_confirm_hint()}</div>
							{/if}
						</button>
					{/each}
				</div>
				<div class="pointer-events-none absolute top-0 right-0 bottom-1 w-8 bg-gradient-to-l from-tape to-transparent"></div>
			</div>
		{:else}
			<p class="text-xs text-dim">{m.frequent_hint()}</p>
		{/if}
	</section>
{/if}
