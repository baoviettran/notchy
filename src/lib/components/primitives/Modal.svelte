<script lang="ts">
	import type { Snippet } from 'svelte';
	let { open = $bindable(false), title = '', children }: {
		open?: boolean; title?: string; children: Snippet;
	} = $props();

	function onBackdrop() { open = false; }
	function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') open = false; }
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" tabindex="-1" onkeydown={onKeydown} role="dialog" aria-modal="true">
		<div class="absolute inset-0 bg-black/70 backdrop-blur-sm" onclick={onBackdrop} role="presentation"></div>
		<div class="relative bg-tape border border-line rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in">
			{#if title}
				<div class="flex items-center justify-between px-6 py-4 border-b border-line">
					<h2 class="figures text-ledger tracking-wide">{title}</h2>
					<button onclick={() => open = false} class="text-dim hover:text-ledger p-1 -mr-1" aria-label="Close">
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
