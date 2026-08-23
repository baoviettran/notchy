<script lang="ts">
	let { label = '', value = $bindable(''), type = 'text', placeholder = '', error = '', disabled = false, id = '', maxlength = undefined, autofocus = false }: {
		label?: string; value?: string; type?: string; placeholder?: string; error?: string; disabled?: boolean; id?: string; maxlength?: number; autofocus?: boolean;
	} = $props();

	// Auto-assign a stable id when none is provided so <label for> associates.
	const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
	const errorId = `${inputId}-error`;
</script>

<div class="space-y-1.5">
	{#if label}
		<label for={inputId} class="plate block">{label}</label>
	{/if}
	<input
		id={inputId} {type} {placeholder} {disabled} {maxlength} {autofocus} bind:value
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-debit' : 'border-line'}
			bg-ink text-ledger placeholder:text-dim
			disabled:opacity-50"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
	/>
	{#if error}
		<p id={errorId} class="text-xs text-debit" role="alert">{error}</p>
	{/if}
</div>
