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
	<div class="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-6 md:translate-x-0 z-50 bg-zinc-800 dark:bg-zinc-700 text-white px-4 py-3 rounded-lg shadow-md flex items-center gap-3 text-sm">
		<span>{message}</span>
		{#if action}
			<button onclick={onaction} class="font-semibold text-emerald-400 hover:text-emerald-300 uppercase text-xs">{action}</button>
		{/if}
	</div>
{/if}
