<script lang="ts">
	import { LayerCake, Svg } from 'layercake';

	type DonutDatum = { label: string; value: number; color: string };

	let { data = [], centerLabel = '' }: { data?: DonutDatum[]; centerLabel?: string } = $props();

	const total = $derived(data.reduce((sum, d) => sum + d.value, 0));
	const arcs = $derived(computeArcs(data, total));

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
	<div class="donut-container">
		<div class="relative">
			<LayerCake data={data} x={(d: DonutDatum) => d.value} y={(_d: DonutDatum, i: number) => i}>
				<Svg>
					<svg viewBox="0 0 100 100" class="w-32 h-32 shrink-0">
						{#each arcs as arc}
							<path d={describeArc(50, 50, 45, arc.startAngle, arc.endAngle)} style="fill: {arc.color}" />
						{/each}
						<circle cx="50" cy="50" r="32" class="fill-tape" />
					</svg>
				</Svg>
			</LayerCake>
			{#if centerLabel}
				<span class="absolute inset-0 flex items-center justify-center figures text-[11px] leading-tight text-ledger truncate pointer-events-none px-1">{centerLabel}</span>
			{/if}
		</div>
		<div class="legend">
			{#each data as d}
				<div class="legend-item">
					<span class="color-swatch" style="background-color: {d.color}"></span>
					<span class="label">{d.label}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.donut-container {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.color-swatch {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}
	.label {
		flex: 1;
	}
</style>
