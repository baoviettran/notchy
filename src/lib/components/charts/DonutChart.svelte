<script lang="ts">
	import { LayerCake, Svg } from 'layercake';

	let { data = [] }: { data: { label: string; value: number; color: string }[] } = $props();

	let total = $derived(data.reduce((s, d) => s + d.value, 0));
	let arcs = $derived(computeArcs(data, total));

	function computeArcs(items: typeof data, total: number) {
		let startAngle = 0;
		return items.map((item) => {
			const angle = total > 0 ? (item.value / total) * 360 : 0;
			const arc = { ...item, startAngle, endAngle: startAngle + angle };
			startAngle += angle;
			return arc;
		});
	}

	function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
		const start = polarToCartesian(cx, cy, r, endAngle);
		const end = polarToCartesian(cx, cy, r, startAngle);
		const largeArc = endAngle - startAngle > 180 ? 1 : 0;
		return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
	}

	function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
		const rad = ((angle - 90) * Math.PI) / 180;
		return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
	}
</script>

{#if data.length > 0 && total > 0}
	<div class="flex items-center gap-6">
		<svg viewBox="0 0 100 100" class="w-32 h-32 shrink-0">
			{#each arcs as arc}
				<path d={describeArc(50, 50, 45, arc.startAngle, arc.endAngle)} fill={arc.color} />
			{/each}
			<!-- Inner circle for donut effect -->
			<circle cx="50" cy="50" r="25" class="fill-tape" />
		</svg>
		<div class="space-y-1 text-sm">
			{#each data as item}
				<div class="flex items-center gap-2">
					<span class="w-3 h-3 rounded-sm shrink-0" style="background: {item.color}"></span>
					<span class="text-dim">{item.label}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
