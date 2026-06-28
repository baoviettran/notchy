<script lang="ts">
	let { label = '', value = $bindable(''), options = [], disabled = false }: {
		label?: string; value?: string; options: { value: string; label: string }[]; disabled?: boolean;
	} = $props();
	const selectId = `select-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="space-y-1">
	{#if label}
		<label for={selectId} class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
	{/if}
	<select
		id={selectId}
		bind:value {disabled}
		class="w-full px-3 py-2 text-base rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
	>
		{#each options as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
</div>
