<script lang="ts">
	let { label = '', value = $bindable(''), options = [], disabled = false, error = '' }: {
		label?: string; value?: string | number | null; options: { value: string | number | null; label: string }[]; disabled?: boolean; error?: string;
	} = $props();
	const selectId = `select-${Math.random().toString(36).slice(2, 9)}`;
	const errorId = `${selectId}-error`;
</script>

<div class="space-y-1.5">
	{#if label}
		<label for={selectId} class="plate block">{label}</label>
	{/if}
	<select
		id={selectId}
		bind:value {disabled}
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-debit' : 'border-line'}
			bg-ink text-ledger
			disabled:opacity-50 disabled:cursor-not-allowed"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
	>
		{#each options as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	{#if error}
		<p id={errorId} class="text-xs text-debit" role="alert">{error}</p>
	{/if}
</div>
