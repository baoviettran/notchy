<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
</script>

{#if toast.current}
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-zinc-800 dark:bg-zinc-700 text-white px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm animate-slide-up">
		<span>{toast.current.message}</span>
		{#if toast.current.action}
			<button
				onclick={() => { toast.current?.onaction?.(); toast.dismiss(); }}
				class="font-semibold text-emerald-400 hover:text-emerald-300 uppercase text-xs shrink-0"
			>{toast.current.action}</button>
		{/if}
		<button onclick={() => toast.dismiss()} class="text-zinc-400 hover:text-white ml-2 text-xs">✕</button>
	</div>
{/if}
