<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
</script>

{#if toast.current}
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm animate-slide-up">
		<span>{toast.current.message}</span>
		{#if toast.current.action}
			<button
				onclick={() => { toast.current?.onaction?.(); toast.dismiss(); }}
				class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs shrink-0"
			>{toast.current.action}</button>
		{/if}
		<button onclick={() => toast.dismiss()} class="text-dim hover:text-ledger ml-2 text-xs">✕</button>
	</div>
{/if}
