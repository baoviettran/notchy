<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';

	let { mode = 'full', onclose = () => {} }: { mode?: 'full' | 'quick'; onclose?: () => void } = $props();

	let kind = $state('expense');
	let amount = $state('');
	let tagId = $state('');
	let accountId = $state('');
	let payee = $state('');
	let date = $state(new Date().toISOString().split('T')[0]);
	let description = $state('');
	let transferAccountId = $state('');
	let saving = $state(false);

	const kinds = [
		{ value: 'expense', label: 'Expense' },
		{ value: 'income', label: 'Income' },
		{ value: 'transfer', label: 'Transfer' },
		{ value: 'refund', label: 'Refund' },
		{ value: 'adjustment', label: 'Adjustment' }
	];

	async function save() {
		saving = true;
		// In production: calls transactions.create() with parsed amount
		saving = false;
		onclose();
	}
</script>

<div class="space-y-4">
	<!-- Kind selector -->
	<div class="flex flex-wrap gap-2">
		{#each kinds as k}
			<button
				onclick={() => kind = k.value}
				class="px-3 py-1.5 text-sm rounded-md border transition-colors {kind === k.value ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 font-medium' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
			>{k.label}</button>
		{/each}
	</div>

	<!-- Amount -->
	<Input label="Amount" bind:value={amount} placeholder="e.g. 50k, 1.5tr, 100+50" />

	{#if kind === 'transfer'}
		<Select label="From Account" bind:value={accountId} options={[]} />
		<Select label="To Account" bind:value={transferAccountId} options={[]} />
	{:else}
		<!-- Tag -->
		<Input label="Tag" bind:value={tagId} placeholder="Search tags..." />
		<Select label="Account" bind:value={accountId} options={[]} />
	{/if}

	{#if mode === 'full'}
		<Input label="Payee" bind:value={payee} placeholder="Who did you pay?" />
		<div class="grid grid-cols-2 gap-3">
			<Input label="Date" type="date" bind:value={date} />
			<Input label="Description" bind:value={description} placeholder="Optional" />
		</div>
	{/if}

	<!-- Actions -->
	<div class="flex justify-end gap-2 pt-2">
		<Button variant="ghost" onclick={onclose}>Cancel</Button>
		{#if mode === 'full'}
			<Button variant="secondary" disabled={saving || !amount}>Save and add</Button>
		{/if}
		<Button disabled={saving || !amount} onclick={save}>Save</Button>
	</div>
</div>
