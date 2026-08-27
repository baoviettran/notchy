<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slideUp } from '$lib/transitions/motion';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	let { open = false, onclose = () => {}, children }: { open?: boolean; onclose?: () => void; children?: Snippet } = $props();

	let sheetEl = $state<HTMLElement | null>(null);
	const focusTrap = createFocusTrap();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			onclose();
		}
	}

	$effect(() => {
		if (open) return focusTrap.enter(() => sheetEl ?? undefined);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Mobile: slide-up sheet with scrim. Desktop: inline (hidden via CSS in parent). -->
{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="md:hidden fixed inset-0 bg-[rgb(var(--scrim-rgb)/0.5)] z-40" onclick={onclose}></div>

	<div
		bind:this={sheetEl}
		tabindex="-1"
		onkeydown={(e) => focusTrap.trap(e, sheetEl ?? undefined)}
		role="dialog"
		aria-label="Filters"
		class="md:hidden fixed bottom-16 left-0 right-0 bg-tape border-t border-line rounded-t-lg p-4 z-50 max-h-[70vh] overflow-y-auto"
		transition:slideUp
	>
		{@render children?.()}
	</div>
{/if}
