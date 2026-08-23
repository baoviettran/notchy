<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	let { open = $bindable(false), title = '', locked = false, children }: {
		open?: boolean; title?: string; locked?: boolean; children: Snippet;
	} = $props();

	let panelEl = $state<HTMLElement>();
	const titleId = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
	const focusTrap = createFocusTrap();

	function onBackdrop() { if (!locked) open = false; }
	// Escape closes (unless locked — e.g. mid-commit); every other key is
	// handed to the Tab trap.
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { if (!locked) open = false; }
		else focusTrap.trap(e, panelEl);
	}

	// Focus lifecycle: capture the trigger, move focus into the dialog when it
	// opens, restore it on close. Runs after the {#if open} block paints, so
	// panelEl is bound before the effect body reads it.
	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" onkeydown={onKeydown} role="dialog" aria-modal="true" aria-labelledby={titleId}>
		<div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={onBackdrop} role="presentation"></div>
		<div bind:this={panelEl} tabindex="-1" class="relative bg-tape border border-line rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
			{#if title}
				<div class="flex items-center justify-between px-6 py-4 border-b border-line">
					<h2 id={titleId} class="figures text-ledger tracking-wide">{title}</h2>
					<button onclick={() => { if (!locked) open = false; }} disabled={locked} class="text-dim hover:text-ledger p-1 -mr-1 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={m.common_close()}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="w-5 h-5"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</div>
			{/if}
			<div class="p-6">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
