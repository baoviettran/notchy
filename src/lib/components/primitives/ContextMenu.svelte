<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createFocusTrap } from '$lib/utils/focusTrap';
	let { label = 'Actions', children }: {
		label?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let panelEl = $state<HTMLElement>();
	// Reuses the focus-in/restore lifecycle from focusTrap.ts (Task 3),
	// parameterized to menuitems instead of the generic FOCUSABLE selector.
	const focusTrap = createFocusTrap('[role="menuitem"]');

	function toggle() { open = !open; }
	function close() { open = false; }

	// Menu focus lifecycle: capture the trigger, focus the first item when the
	// menu opens, restore the trigger when it closes.
	$effect(() => {
		if (open) return focusTrap.enter(() => panelEl);
	});

	function onMenuKeydown(e: KeyboardEvent) {
		const items = Array.from(panelEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
			.filter((el) => {
				const style = getComputedStyle(el);
				return style.display !== 'none' && style.visibility !== 'hidden';
			});
		if (items.length === 0) { if (e.key === 'Escape') close(); return; }
		const idx = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
		else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
		else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
		else if (e.key === 'Escape') { close(); }
	}
</script>

<div class="relative">
	<!-- The pseudo-element widens the hit target to ~44px on touch without
	     changing the visual footprint in dense rows. -->
	<button
		onclick={toggle}
		class="relative p-2 -m-1 text-dim hover:text-ledger hover:bg-line/40 rounded transition-colors before:content-[''] before:absolute before:-inset-2"
		aria-label={label}
		aria-haspopup="menu"
		aria-expanded={open}
	>
		<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
			<circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
		</svg>
	</button>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			data-testid="menu-backdrop"
			class="fixed inset-0 z-10"
			onclick={close}
			onkeydown={(e) => e.key === 'Escape' && close()}
		></div>
		<div
			bind:this={panelEl}
			class="absolute right-0 mt-1 w-40 bg-tape border border-line rounded-md shadow-lg z-20 origin-top-right animate-scale-in"
			role="menu"
			tabindex="-1"
			onkeydown={onMenuKeydown}
			onclick={close}
		>
			{@render children()}
		</div>
	{/if}
</div>
