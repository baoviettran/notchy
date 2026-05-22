<script lang="ts">
	let { label = '', value = $bindable(''), type = 'text', placeholder = '', error = '', disabled = false, id = '' }: {
		label?: string; value?: string; type?: string; placeholder?: string; error?: string; disabled?: boolean; id?: string;
	} = $props();
</script>

<div class="space-y-1">
	{#if label}
		<label for={id} class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
	{/if}
	<input
		{id} {type} {placeholder} {disabled} bind:value
		class="w-full px-3 py-2 text-base rounded-md border transition-colors
			{error ? 'border-red-500' : 'border-zinc-200 dark:border-zinc-700'}
			bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50
			focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
	/>
	{#if error}
		<p class="text-xs text-red-500">{error}</p>
	{/if}
</div>
