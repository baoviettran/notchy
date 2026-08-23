<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleTime, scaleLinear } from 'd3-scale';
	import { line, area } from 'd3-shape';
	import * as m from '$lib/paraglide/messages';

	let {
		data,
		yFormat,
		xFormat,
		showArea = true,
		label
	}: {
		data: { x: Date; y: number }[];
		yFormat: (n: number) => string;
		xFormat: (d: Date) => string;
		showArea?: boolean;
		label?: string;
	} = $props();

	const chartWidth = 400;
	const chartHeight = 200;
	const margin = { top: 10, right: 10, bottom: 30, left: 50 };
	const innerWidth = chartWidth - margin.left - margin.right;
	const innerHeight = chartHeight - margin.top - margin.bottom;

	const xScale = $derived(
		data.length > 0
			? scaleTime()
					.domain([
						new Date(Math.min(...data.map((d) => d.x.getTime()))),
						new Date(Math.max(...data.map((d) => d.x.getTime())))
					])
					.range([0, innerWidth])
			: scaleTime().range([0, innerWidth])
	);

	const yScale = $derived(
		data.length > 0
			? scaleLinear()
					.domain([Math.min(...data.map((d) => d.y)), Math.max(...data.map((d) => d.y))])
					.range([innerHeight, 0])
			: scaleLinear().range([innerHeight, 0])
	);

	const linePath = $derived(
		data.length > 0
			? line<{ x: Date; y: number }>()
					.x((d) => xScale(d.x))
					.y((d) => yScale(d.y))(data) ?? ''
			: ''
	);

	const areaPath = $derived(
		data.length > 0 && showArea
			? area<{ x: Date; y: number }>()
					.x((d) => xScale(d.x))
					.y0(innerHeight)
					.y1((d) => yScale(d.y))(data) ?? ''
			: ''
	);

	const xTicks = $derived(data.length > 0 ? xScale.ticks(5) : []);
	const yTicks = $derived(data.length > 0 ? yScale.ticks(5) : []);
</script>

{#if data.length > 0}
	<LayerCake data={data} x="x" y="y">
		<Svg>
			<svg viewBox="0 0 {chartWidth} {chartHeight}" class="line-chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
				<g transform="translate({margin.left}, {margin.top})">
					<!-- Area fill -->
					{#if showArea && areaPath}
						<path d={areaPath} class="area-fill" />
					{/if}

					<!-- Line -->
					{#if linePath}
						<path d={linePath} class="line-stroke" />
					{/if}

					<!-- X Axis -->
					<g class="axis x-axis" transform="translate(0, {innerHeight})">
						<line x1={0} y1={0} x2={innerWidth} y2={0} class="axis-line" />
						{#each xTicks as tick}
							<g transform="translate({xScale(tick)}, 0)">
								<line y2="6" class="tick-line" />
								<text y="20" class="tick-label">{xFormat(tick)}</text>
							</g>
						{/each}
					</g>

					<!-- Y Axis -->
					<g class="axis y-axis">
						<line x1={0} y1={0} x2={0} y2={innerHeight} class="axis-line" />
						{#each yTicks as tick}
							<g transform="translate(0, {yScale(tick)})">
								<line x2="-6" class="tick-line" />
								<text x="-10" class="tick-label">{yFormat(tick)}</text>
							</g>
						{/each}
					</g>
				</g>
			</svg>
		</Svg>
	</LayerCake>

	<!-- Non-visual readers get the actual data, not just the chart's name. -->
	{#if label}
		<table class="sr-only">
			<caption>{label}</caption>
			<thead>
				<tr>
					<th scope="col">{m.chart_col_period()}</th>
					<th scope="col">{m.chart_col_amount()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data as p}
					<tr>
						<th scope="row">{xFormat(p.x)}</th>
						<td>{yFormat(p.y)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	.line-chart {
		width: 100%;
		height: 100%;
	}

	.area-fill {
		fill: var(--phosphor);
		opacity: 0.2;
	}

	.line-stroke {
		fill: none;
		stroke: var(--phosphor);
		stroke-width: 2;
	}

	.axis-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-label {
		fill: var(--dim);
		font-size: 11px;
		text-anchor: middle;
	}

	.y-axis .tick-label {
		text-anchor: end;
		dominant-baseline: middle;
	}
</style>
