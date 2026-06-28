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
		{ value: 'savings', label: 'Savings' },
		{ value: 'debt_payoff', label: 'Debt Payoff' },
		{ value: 'net_worth', label: 'Net Worth' }
	];
	const accountOptions = $derived([
		{ value: '', label: '— None —' },
		...accounts.items.map((a) => ({ value: a.id, label: a.name }))
	]);
	const isEdit = $derived(goal !== null);

	async function save() {
		if (!name.trim()) { error = 'Name is required'; return; }
		if (!targetDate) { error = 'Target date is required'; return; }
		saving = true;
		error = '';
		try {
			const parsed = parseAmount(targetAmount, settings.locale, settings.currency);
			if (isEdit && goal) {
				await goals.update(goal.id, { name, target_amount: parsed, target_date: targetDate });
				toast.show('Goal updated.');
			} else {
				await goals.create({
					name, type, target_amount: parsed, target_date: targetDate,
					linked_account_id: linkedAccountId || null,
					starting_amount: 0
				});
				toast.show('Goal created.');
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
	{#if error}<p class="text-sm text-red-500">{error}</p>{/if}

	<Input label="Name" bind:value={name} placeholder="e.g. Vacation 2026" maxlength={64} />
	<Select label="Type" bind:value={type} options={types} disabled={isEdit} />
	<Input label="Target amount" bind:value={targetAmount} placeholder="e.g. 10tr" />
	<Input label="Target date" type="date" bind:value={targetDate} />
	{#if type !== 'net_worth'}
		<Select label="Linked account" bind:value={linkedAccountId} options={accountOptions} />
	{/if}

	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		<Button disabled={saving} onclick={save}>{isEdit ? 'Save' : 'Create'}</Button>
	</div>
</div>
