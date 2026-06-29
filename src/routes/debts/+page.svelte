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
	import * as m from '$lib/paraglide/messages';

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
			const parsed = parseAmount(amount, settings.locale, settings.currency);
			if (actionType === 'payment') {
				if (!fromAccount) { toast.show(m.debts_select_account()); saving = false; return; }
				// Payment is a transfer from fromAccount to the debt account
				await transactions.create({
					kind: 'transfer',
					date: new Date().toISOString().split('T')[0],
					amount: parsed,
					account_id: activeDebt.type === 'loan_from_person' ? fromAccount : activeDebt.id,
					transfer_account_id: activeDebt.type === 'loan_from_person' ? activeDebt.id : fromAccount
				});
				await debts.load();
				toast.show(m.debts_payment_recorded());
			} else {
				const db = await getDb();
				await writeOff(db, activeDebt.id, parsed);
				await debts.load();
				toast.show(m.debts_written_off());
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
	<h1 class="figures text-xl text-ledger tracking-wide">{m.debts_title()}</h1>

	<section>
		<h2 class="plate mb-2">{m.debts_i_owe()}</h2>
		{#if debts.i_owe.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.debts_empty_i_owe()}</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each debts.i_owe as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-ledger">{d.counterparty}</div>
							<div class="text-xs text-dim">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="figures text-sm text-debit">{formatCurrency(Math.abs(d.balance), settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-phosphor hover:underline px-2">{m.debts_pay()}</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-dim hover:underline px-2">{m.debts_write_off()}</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">{m.debts_owed_to_me()}</h2>
		{#if debts.owed_to_me.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.debts_empty_owed_to_me()}</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each debts.owed_to_me as d}
					<div class="p-4 flex items-center justify-between group">
						<div>
							<div class="text-sm font-medium text-ledger">{d.counterparty}</div>
							<div class="text-xs text-dim">{d.name}</div>
						</div>
						<div class="flex items-center gap-2">
							<span class="figures text-sm text-phosphor">{formatCurrency(d.balance, settings.currency, settings.locale)}</span>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openPayment(d)} class="text-xs text-phosphor hover:underline px-2">{m.debts_receive()}</button>
								<button onclick={() => openWriteoff(d)} class="text-xs text-dim hover:underline px-2">{m.debts_write_off()}</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<Modal bind:open={showAction} title={actionType === 'payment' ? (activeDebt?.type === 'loan_from_person' ? m.debts_make_payment() : m.debts_receive_payment()) : m.debts_write_off_debt()}>
	<div class="space-y-4">
		<Input label={m.common_amount()} bind:value={amount} placeholder={m.forms_amount_placeholder()} />
		{#if actionType === 'payment'}
			<Select label={activeDebt?.type === 'loan_from_person' ? m.debts_from_account() : m.debts_to_account()} bind:value={fromAccount} options={assetAccounts} />
		{/if}
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => showAction = false}>{m.common_cancel()}</Button>
			<Button disabled={saving} onclick={doAction}>{actionType === 'payment' ? m.debts_record() : m.debts_write_off()}</Button>
		</div>
	</div>
</Modal>
