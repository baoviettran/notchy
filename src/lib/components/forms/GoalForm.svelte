<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { goals } from '$lib/stores/goals.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { parseAmount } from '$lib/utils/number_parse';
	import type { GoalWithProgress, GoalType } from '$lib/db/repos/goals';
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';

	let { goal = null, onclose = () => {} }: { goal?: GoalWithProgress | null; onclose?: () => void } = $props();

	let name = $state(goal?.name ?? '');
	let type = $state<GoalType>(goal?.type ?? 'savings');
	let targetAmount = $state(goal?.target_amount ? String(goal.target_amount) : '');
	let targetDate = $state(goal?.target_date ?? '');
	let linkedAccountId = $state(goal?.linked_account_id ?? '');
	let saving = $state(false);
	let error = $state('');

	onMount(() => accounts.load());

	const types = [
		{ value: 'savings', label: m.forms_goal_type_savings() },
		{ value: 'debt_payoff', label: m.forms_goal_type_debt_payoff() },
		{ value: 'net_worth', label: m.forms_goal_type_net_worth() }
	];
	const accountOptions = $derived([
		{ value: '', label: m.common_none() },
		...accounts.items.map((a) => ({ value: a.id, label: a.name }))
	]);
	const isEdit = $derived(goal !== null);

	async function save() {
		if (!name.trim()) { error = m.validation_name_required(); return; }
		if (!targetDate) { error = m.validation_target_date_required(); return; }
		saving = true;
		error = '';
		try {
			const parsed = parseAmount(targetAmount, settings.locale, settings.currency);
			if (isEdit && goal) {
				await goals.update(goal.id, { name, target_amount: parsed, target_date: targetDate });
				toast.show(m.forms_goal_updated());
			} else {
				await goals.create({
					name, type, target_amount: parsed, target_date: targetDate,
					linked_account_id: linkedAccountId || null,
					starting_amount: 0
				});
				toast.show(m.forms_goal_created());
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

	<Input label={m.common_name()} bind:value={name} placeholder={m.forms_goal_name_placeholder()} maxlength={64} />
	<Select label={m.forms_type()} bind:value={type} options={types} disabled={isEdit} />
	<Input label={m.forms_target_amount()} bind:value={targetAmount} placeholder={m.forms_target_amount_placeholder()} />
	<Input label={m.forms_target_date()} type="date" bind:value={targetDate} />
	{#if type !== 'net_worth'}
		<Select label={m.forms_linked_account()} bind:value={linkedAccountId} options={accountOptions} />
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>{m.common_cancel()}</Button>
		<Button disabled={saving} onclick={save}>{isEdit ? m.common_save() : m.forms_create()}</Button>
	</div>
</div>
