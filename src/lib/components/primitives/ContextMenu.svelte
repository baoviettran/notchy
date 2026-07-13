<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label = 'Actions', children }: {
		label?: string;
		children: Snippet;
	} = $props();

	let open = $state(false);

	function toggle() { open = !open; }
	function close() { open = false; }
</script>

<div class="relative">
	<button
		onclick={toggle}
		class="p-1 text-dim hover:text-ledger"
		aria-label={label}
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
			class="absolute right-0 mt-1 w-40 bg-tape border border-line rounded-md shadow-lg z-20 animate-scale-in"
			role="menu"
			tabindex="-1"
			onkeydown={(e) => e.key === 'Escape' && close()}
		>
			{@render children()}
		</div>
	{/if}
</div>
