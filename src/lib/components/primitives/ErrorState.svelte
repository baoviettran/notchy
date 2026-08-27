<script lang="ts">
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';

	let { description = '', onRetry = null }: {
		description?: string;
		onRetry?: (() => void) | null;
	} = $props();
</script>

<div class="surface rounded-lg p-6 text-center space-y-3" role="alert" aria-live="assertive">
	<!-- ⚠︎ is the vocabulary's alarm glyph (DESIGN.md §6) — no off-table icons.
	     U+FE0E forces text presentation so the glyph renders as a typographic
	     character, not a platform emoji. -->
	<p class="figures text-2xl text-debit" aria-hidden="true">⚠︎</p>
	<h2 class="text-lg font-semibold text-ledger">{m.errors_state_title()}</h2>
	<p class="text-sm text-dim">{description}</p>
	{#if onRetry}
		<div class="pt-2">
			<Button variant="secondary" onclick={onRetry}>{m.errors_state_retry()}</Button>
		</div>
	{/if}
</div>
