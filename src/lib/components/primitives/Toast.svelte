<script lang="ts">
	let { message = '', action = '', onaction = () => {}, visible = $bindable(false) }: {
		message?: string; action?: string; onaction?: () => void; visible?: boolean;
	} = $props();

	$effect(() => {
		if (visible) {
			const timer = setTimeout(() => { visible = false; }, 5000);
			return () => clearTimeout(timer);
		}
	});
</script>

{#if visible}
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-tape border border-line text-ledger px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm">
		<span>{message}</span>
		{#if action}
			<button onclick={onaction} class="font-semibold text-phosphor hover:text-phosphor-bright uppercase text-xs">{action}</button>
		{/if}
	</div>
{/if}
