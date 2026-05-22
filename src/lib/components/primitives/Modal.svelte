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
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" onkeydown={onKeydown} role="dialog" aria-modal="true">
		<div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick={onBackdrop} role="presentation"></div>
		<div class="relative bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in">
			{#if title}
				<div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
					<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
					<button onclick={() => open = false} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">✕</button>
				</div>
			{/if}
			<div class="p-6">
				{@render children()}
			</div>
		</div>
	</div>
{/if}
