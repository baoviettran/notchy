<script lang="ts">
	let { label = '', value = $bindable(''), options = [], disabled = false }: {
		label?: string; value?: string; options: { value: string; label: string }[]; disabled?: boolean;
	} = $props();
	const selectId = `select-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="space-y-1">
	{#if label}
		<label for={selectId} class="plate block">{label}</label>
	{/if}
	<select
		id={selectId}
		bind:value {disabled}
		class="w-full px-3 py-2 text-base rounded-md border border-line bg-ink text-ledger"
	>
		{#each options as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
</div>
