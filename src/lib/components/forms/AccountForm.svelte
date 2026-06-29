<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { AccountWithBalance, AccountType } from '$lib/db/repos/accounts';

	let { account = null, onclose = () => {} }: { account?: AccountWithBalance | null; onclose?: () => void } = $props();

	let name = $state(account?.name ?? '');
	let type = $state<AccountType>(account?.type ?? 'checking');
	let counterparty = $state(account?.counterparty ?? '');
	let initialBalance = $state('');
	let saving = $state(false);
	let error = $state('');

	const types: { value: AccountType; label: string }[] = [
		{ value: 'checking', label: 'Checking' },
		{ value: 'savings', label: 'Savings' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'credit_card', label: 'Credit Card' },
		{ value: 'loan_to_person', label: 'Loan to Person' },
		{ value: 'loan_from_person', label: 'Loan from Person' }
	];

	const isLoan = $derived(type === 'loan_to_person' || type === 'loan_from_person');
	const isEdit = $derived(account !== null);

	async function save() {
		if (!name.trim()) { error = 'Name is required'; return; }
		if (isLoan && !counterparty.trim()) { error = 'Counterparty is required for loans'; return; }
		saving = true;
		error = '';
		try {
			if (isEdit && account) {
				await accounts.update(account.id, { name, type, counterparty: isLoan ? counterparty : null });
				toast.show('Account updated.');
			} else {
				let balance: number | undefined;
				if (initialBalance.trim()) {
					try { balance = parseAmount(initialBalance, settings.locale, settings.currency); } catch { error = 'Invalid amount'; saving = false; return; }
				}
				await accounts.create({
					name, type, currency: settings.currency,
					counterparty: isLoan ? counterparty : null,
					initial_balance: balance,
					initial_balance_date: new Date().toISOString().split('T')[0]
				});
				toast.show('Account created.');
			}
			onclose();
		} catch (e) {
			error = String(e).replace('Error: ', '');
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4">
	{#if error}<p class="text-sm text-debit">{error}</p>{/if}

	<Input label="Name" bind:value={name} placeholder="e.g. Vietcombank Checking" maxlength={64} />
	<Select label="Type" bind:value={type} options={types} disabled={isEdit} />
	{#if isLoan}
		<Input label="Counterparty" bind:value={counterparty} placeholder="Person's name" maxlength={64} />
	{/if}
	{#if !isEdit}
		<Input label="Initial balance (optional)" bind:value={initialBalance} placeholder="e.g. 5tr, 1000000" />
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		<Button disabled={saving} onclick={save}>{isEdit ? 'Save' : 'Create'}</Button>
	</div>
</div>
