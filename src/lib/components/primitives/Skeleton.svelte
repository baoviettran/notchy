<script lang="ts">
	let { lines = 3, height = 'h-4' }: { lines?: number; height?: string } = $props();
</script>

<div class="animate-pulse space-y-3">
	{#each Array(lines) as _}
		<div class="{height} bg-line rounded"></div>
	{/each}
</div>
