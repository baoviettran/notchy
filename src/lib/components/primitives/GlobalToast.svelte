<script lang="ts">
	import { toast } from '$lib/stores/toast.svelte';
	import * as m from '$lib/paraglide/messages';
</script>

<!-- Persistent status region: the wrapper is always mounted so screen readers
     announce the message when it is inserted into the region (role="status" is
     implicitly aria-live="polite" + aria-atomic). -->
<!-- md+: the sidebar owns the left 15rem, so the toast docks inside the
     content column instead of covering the sidebar's LOCAL · OFFLINE plate. -->
<div
	role="status"
	aria-live="polite"
	class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-[17.5rem] md:translate-x-0 z-50"
	onpointerenter={() => toast.pause()}
	onpointerleave={() => toast.resume()}
	onfocusin={() => toast.pause()}
	onfocusout={() => toast.resume()}
>
	{#if toast.current}
		<div class="bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm animate-slide-up">
			{#key toast.current.id}
				<!-- The machine registering the save: one phosphor flicker on each
				     new figure, settling back to the resting glow. -->
				<span class="animate-flash">{toast.current.message}</span>
			{/key}
			{#if toast.current.action}
				<button
					onclick={() => { toast.current?.onaction?.(); toast.dismiss(); }}
					class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs shrink-0"
				>{toast.current.action}</button>
			{/if}
			<button onclick={() => toast.dismiss()} aria-label={m.common_close()} class="text-dim hover:text-ledger ml-2 text-xs">✕</button>
		</div>
	{/if}
</div>
