<script lang="ts">
	let { label = '', value = $bindable(''), type = 'text', placeholder = '', error = '', disabled = false, id = '', maxlength = undefined }: {
		label?: string; value?: string; type?: string; placeholder?: string; error?: string; disabled?: boolean; id?: string; maxlength?: number;
	} = $props();

	// Auto-assign a stable id when none is provided so <label for> associates.
	const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="space-y-1.5">
	{#if label}
		<label for={inputId} class="plate block">{label}</label>
	{/if}
	<input
		id={inputId} {type} {placeholder} {disabled} {maxlength} bind:value
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-debit' : 'border-line'}
			bg-ink text-ledger placeholder:text-dim/60
			disabled:opacity-50"
	/>
	{#if error}
		<p class="text-xs text-debit">{error}</p>
	{/if}
</div>
