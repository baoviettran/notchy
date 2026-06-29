<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { AccountWithBalance, AccountType } from '$lib/db/repos/accounts';
	import * as m from '$lib/paraglide/messages';

	let { account = null, onclose = () => {} }: { account?: AccountWithBalance | null; onclose?: () => void } = $props();

	let name = $state(account?.name ?? '');
	let type = $state<AccountType>(account?.type ?? 'checking');
	let counterparty = $state(account?.counterparty ?? '');
	let initialBalance = $state('');
	let saving = $state(false);
	let error = $state('');

	const types: { value: AccountType; label: string }[] = [
		{ value: 'checking', label: m.forms_account_type_checking() },
		{ value: 'savings', label: m.forms_account_type_savings() },
		{ value: 'cash', label: m.forms_account_type_cash() },
		{ value: 'credit_card', label: m.forms_account_type_credit_card() },
		{ value: 'loan_to_person', label: m.forms_account_type_loan_to_person() },
		{ value: 'loan_from_person', label: m.forms_account_type_loan_from_person() }
	];

	const isLoan = $derived(type === 'loan_to_person' || type === 'loan_from_person');
	const isEdit = $derived(account !== null);

	async function save() {
		if (!name.trim()) { error = m.validation_name_required(); return; }
		if (isLoan && !counterparty.trim()) { error = m.validation_counterparty_required(); return; }
		saving = true;
		error = '';
		try {
			if (isEdit && account) {
				await accounts.update(account.id, { name, type, counterparty: isLoan ? counterparty : null });
				toast.show(m.forms_account_updated());
			} else {
				let balance: number | undefined;
				if (initialBalance.trim()) {
					try { balance = parseAmount(initialBalance, settings.locale, settings.currency); } catch { error = m.validation_invalid_amount(); saving = false; return; }
				}
				await accounts.create({
					name, type, currency: settings.currency,
					counterparty: isLoan ? counterparty : null,
					initial_balance: balance,
					initial_balance_date: new Date().toISOString().split('T')[0]
				});
				toast.show(m.forms_account_created());
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

	<Input label={m.common_name()} bind:value={name} placeholder={m.forms_account_name_placeholder()} maxlength={64} />
	<Select label={m.forms_type()} bind:value={type} options={types} disabled={isEdit} />
	{#if isLoan}
		<Input label={m.forms_counterparty()} bind:value={counterparty} placeholder={m.forms_counterparty_hint()} maxlength={64} />
	{/if}
	{#if !isEdit}
		<Input label={m.forms_initial_balance()} bind:value={initialBalance} placeholder={m.forms_initial_balance_placeholder()} />
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>{m.common_cancel()}</Button>
		<Button disabled={saving} onclick={save}>{isEdit ? m.common_save() : m.forms_create()}</Button>
	</div>
</div>
