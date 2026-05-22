<script lang="ts">
	let { value = 0, max = 100, size = 'md' }: { value?: number; max?: number; size?: 'sm' | 'md' } = $props();
	const pct = Math.min(100, Math.max(0, (value / max) * 100));
	const overBudget = pct > 100;
	const heights = { sm: 'h-1.5', md: 'h-2.5' };
</script>

<div class="w-full {heights[size]} bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
	<div
		class="h-full rounded-full transition-all {overBudget ? 'bg-red-500' : 'bg-emerald-500'}"
		style="width: {Math.min(pct, 100)}%"
	></div>
</div>
