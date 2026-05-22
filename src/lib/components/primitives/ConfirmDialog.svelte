<script lang="ts">
	import Button from './Button.svelte';

	let { open = $bindable(false), title = '', message = '', confirmLabel = 'Delete', danger = true, onconfirm = () => {} }: {
		open?: boolean; title?: string; message?: string; confirmLabel?: string; danger?: boolean; onconfirm?: () => void;
	} = $props();

	function confirm() { onconfirm(); open = false; }
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-black/40 backdrop-blur-sm" onclick={() => open = false} role="presentation"></div>
		<div class="relative bg-white dark:bg-zinc-800 rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-scale-in">
			<h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
			{#if message}
				<p class="text-sm text-zinc-500">{message}</p>
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => open = false}>Cancel</Button>
				<Button variant={danger ? 'danger' : 'primary'} onclick={confirm}>{confirmLabel}</Button>
			</div>
		</div>
	</div>
{/if}
