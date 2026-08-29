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
	<div class="relative">
		<select
			id={selectId}
			bind:value {disabled}
			class="w-full appearance-none px-3 py-2 pr-8 text-base rounded-md border transition-colors
				{error ? 'border-debit focus:border-debit' : 'border-line focus:border-phosphor'}
				bg-ink text-ledger
				disabled:opacity-50 disabled:cursor-not-allowed
				focus:outline-none focus:ring-0"
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? errorId : undefined}
		>
			{#each options as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
		<!-- Custom chevron: the native one varies across platforms and often
		     clashes with the app's VFD aesthetic. -->
		<span class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-dim text-sm">▾</span>
	</div>
	{#if error}
		<p id={errorId} class="text-xs text-debit" role="alert">{error}</p>
	{/if}
</div>
