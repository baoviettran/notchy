<script lang="ts">
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';

	let { description = '', onRetry = null }: {
		description?: string;
		onRetry?: (() => void) | null;
	} = $props();
</script>

<div class="surface rounded-lg p-6 text-center space-y-3" role="alert" aria-live="assertive">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-10 h-10 mx-auto text-debit" aria-hidden="true">
		<circle cx="12" cy="12" r="10" />
		<line x1="12" y1="8" x2="12" y2="12" />
		<line x1="12" y1="16" x2="12.01" y2="16" />
	</svg>
	<h2 class="text-lg font-semibold text-ledger">{m.errors_state_title()}</h2>
	<p class="text-sm text-dim">{description}</p>
	{#if onRetry}
		<div class="pt-2">
			<Button variant="secondary" onclick={onRetry}>{m.errors_state_retry()}</Button>
		</div>
	{/if}
</div>
