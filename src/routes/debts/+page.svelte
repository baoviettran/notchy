<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { debts } from '$lib/stores/debts.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { transactions } from '$lib/stores/transactions.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getDb } from '$lib/db';
	import { writeOff } from '$lib/db/repos/debts';
	import { formatCurrency } from '$lib/utils/currency';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { DebtAccount } from '$lib/db/repos/debts';

	let showAction = $state(false);
	let actionType = $state<'payment' | 'writeoff'>('payment');
	let activeDebt = $state<DebtAccount | null>(null);
	let amount = $state('');
	let fromAccount = $state('');
	let saving = $state(false);

	onMount(async () => { await debts.load(); await accounts.load(); });

	function openPayment(d: DebtAccount) {
		activeDebt = d; actionType = 'payment'; amount = ''; fromAccount = ''; showAction = true;
	}
	function openWriteoff(d: DebtAccount) {
		activeDebt = d; actionType = 'writeoff'; amount = ''; showAction = true;
	}

	async function doAction() {
		if (!activeDebt || !amount) return;
		saving = true;
		try {
			const parsed = parseAmount(amount, settings.locale);
			if (actionType === 'payment') {
				if (!fromAccount) { toast.show('Select an account.'); saving = false; return; }
				// Payment is a transfer from fromAccount to the debt account
				await transactions.create({
					kind: 'transfer',
					date: new Date().toISOString().split('T')[0],
					amount: parsed,
					account_id: activeDebt.type === 'loan_from_person' ? fromAccount : activeDebt.id,
					transfer_account_id: activeDebt.type === 'loan_from_person' ? activeDebt.id : fromAccount
				});
				toast.show('Payment recorded.');
			} else {
				const db = await getDb();
				await writeOff(db, activeDebt.id, parsed);
				await debts.load();
				toast.show('Debt written off.');
			}
			showAction = false;
		} catch (e) {
			toast.show(String(e).replace('Error: ', ''));
		} finally {
			saving = false;
		}
	}

	const assetAccounts = $derived(accounts.assets.map((a) => ({ value: a.id, label: a.name })));
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Debts</h1>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">I Owe</h2>
		{#if debts.i_owe.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No debts. You're debt-free! 🎉</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each debts.i_owe as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.counterparty}</div>
							<div class="text-xs text-zinc-500">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-sm tabular-nums text-red-500">{formatCurrency(Math.abs(d.balance), settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-emerald-600 hover:underline px-2">Pay</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-zinc-500 hover:underline px-2">Write off</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Owed to Me</h2>
		{#if debts.owed_to_me.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No one owes you money.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each debts.owed_to_me as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.counterparty}</div>
							<div class="text-xs text-zinc-500">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-sm tabular-nums text-emerald-600">{formatCurrency(d.balance, settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-emerald-600 hover:underline px-2">Receive</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-zinc-500 hover:underline px-2">Write off</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<Modal bind:open={showAction} title={actionType === 'payment' ? (activeDebt?.type === 'loan_from_person' ? 'Make payment' : 'Receive payment') : 'Write off debt'}>
	<div class="space-y-4">
		<Input label="Amount" bind:value={amount} placeholder="e.g. 500k" />
		{#if actionType === 'payment'}
			<Select label={activeDebt?.type === 'loan_from_person' ? 'From account' : 'To account'} bind:value={fromAccount} options={assetAccounts} />
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => showAction = false}>Cancel</Button>
			<Button disabled={saving} onclick={doAction}>{actionType === 'payment' ? 'Record' : 'Write off'}</Button>
		</div>
	</div>
</Modal>
