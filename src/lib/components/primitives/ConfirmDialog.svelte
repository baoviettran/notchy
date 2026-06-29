<script lang="ts">
	import Button from './Button.svelte';
	import * as m from '$lib/paraglide/messages';

	let { open = $bindable(false), title = '', message = '', confirmLabel = '', danger = true, onconfirm = () => {} }: {
		open?: boolean; title?: string; message?: string; confirmLabel?: string; danger?: boolean; onconfirm?: () => void;
	} = $props();

	function confirm() { onconfirm(); open = false; }
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick={() => open = false} role="presentation"></div>
		<div class="relative bg-tape border border-line rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-scale-in">
			<h2 class="text-lg font-semibold text-ledger">{title}</h2>
			{#if message}
				<p class="text-sm text-dim">{message}</p>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => open = false}>{m.common_cancel()}</Button>
				<Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel || m.common_delete()}</Button>
			</div>
		</div>
	</div>
{/if}
