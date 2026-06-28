<script lang="ts">
	let { value = 0, max = 100, size = 'md', segments = 20 }: {
		value?: number; max?: number; size?: 'sm' | 'md'; segments?: number;
	} = $props();
	const pct = Math.min(100, Math.max(0, (value / max) * 100));
	const overBudget = pct > 100;
	const heights = { sm: 'h-2', md: 'h-3' };
	const filled = Math.round((Math.min(pct, 100) / 100) * segments);
</script>

<!-- Segmented VFD bar: like the meters on old hardware, not a smooth blob. -->
<div
	class="w-full {heights[size]} flex gap-[2px] p-[2px] rounded-sm border border-line bg-ink overflow-hidden"
	role="progressbar"
	aria-valuenow={Math.round(pct)}
	aria-valuemin={0}
	aria-valuemax={100}
>
	{#each Array(segments) as _, i}
		<div
			class="flex-1 rounded-[1px] transition-colors {overBudget && i < filled
				? 'bg-debit'
				: i < filled ? 'bg-phosphor' : 'bg-line/60'}"
		></div>
	{/each}
</div>
