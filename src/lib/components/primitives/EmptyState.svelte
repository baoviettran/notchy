<script lang="ts">
	import type { Snippet } from 'svelte';

	type Glyph = 'tape' | 'register' | 'vault' | 'envelope' | 'target';

	// Machine "modes" — each empty state reads as a different idle display
	// waiting for input, not a dead end. Decorative only; aria-hidden.
	const GLYPHS: Record<Glyph, string> = {
		tape: '▮▯▯▯',
		register: '▯▯▯▯',
		vault: '▣▯',
		envelope: '▤▯',
		target: '◇▯'
	};

	let {
		glyph = 'tape',
		icon = undefined,
		title = undefined,
		message,
		action = undefined
	}: {
		glyph?: Glyph;
		icon?: string;
		title?: string;
		message: string;
		action?: Snippet;
	} = $props();

	const shown = $derived(icon ?? GLYPHS[glyph] ?? GLYPHS.tape);
</script>

<div class="text-center py-12 px-4" role="status">
	<!-- Decorative machine glyph — meaningless to a screen reader, hidden. -->
	<p
		class="figures-glow glyph text-2xl mb-3"
		aria-hidden="true"
	>{shown}</p>
	{#if title}<p class="empty-title text-ledger font-medium mb-1">{title}</p>{/if}
	<p class="text-sm text-dim leading-relaxed max-w-xs mx-auto">{message}</p>
	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>

<style>
	/* A slow phosphor "boot flicker" so the idle glyph reads as a live display
	   waiting for the first keystroke. Disabled for reduced-motion users. */
	.glyph {
		animation: flicker 3.2s ease-in-out infinite;
	}
	@keyframes flicker {
		0%, 100% { opacity: 1; }
		45% { opacity: 1; }
		50% { opacity: 0.55; }
		55% { opacity: 1; }
		70% { opacity: 0.8; }
		75% { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.glyph {
			animation: none;
		}
	}
</style>
