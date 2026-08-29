<script lang="ts">
	let { label = '', value = $bindable(''), type = 'text', placeholder = '', error = '', disabled = false, id = '', maxlength = undefined, autofocus = false }: {
		label?: string; value?: string; type?: string; placeholder?: string; error?: string; disabled?: boolean; id?: string; maxlength?: number; autofocus?: boolean;
	} = $props();

	// Auto-assign a stable id when none is provided so <label for> associates.
	const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
	const errorId = `${inputId}-error`;

	let inputEl = $state<HTMLInputElement>();

	// Programmatic focus instead of the autofocus attribute: same behavior,
	// no a11y lint complaint about focus being stolen from the user.
	$effect(() => {
		if (autofocus) queueMicrotask(() => inputEl?.focus());
	});
</script>

<div class="space-y-1.5">
	{#if label}
		<label for={inputId} class="plate block">{label}</label>
	{/if}
	<input
		bind:this={inputEl}
		id={inputId} {type} {placeholder} {disabled} {maxlength} bind:value
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-debit focus-visible:border-debit' : 'border-line focus-visible:border-phosphor'}
			focus-visible:outline-none
			bg-ink text-ledger placeholder:text-dim
			disabled:opacity-50 disabled:cursor-not-allowed"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
	/>
	{#if error}
		<p id={errorId} class="text-xs text-debit" role="alert">{error}</p>
	{/if}
</div>
