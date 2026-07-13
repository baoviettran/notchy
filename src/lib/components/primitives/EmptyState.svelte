<script lang="ts">
	import type { Snippet } from 'svelte';
	let { icon = '▮▯▯▯', message, action }: {
		icon?: string;
		message: string;
		action?: Snippet;
	} = $props();
</script>

<div class="text-center py-12">
	<p class="figures-glow text-2xl mb-2">{icon}</p>
	<p class="text-sm text-dim">{message}</p>
	{#if action}
		<div class="mt-4">
			{@render action()}
		</div>
	{/if}
</div>
