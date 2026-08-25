<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { stack, area, type SeriesPoint } from 'd3-shape';
	import * as m from '$lib/paraglide/messages';

	type StackDatum = {
		month: string;
		[key: string]: string | number;
	};

	let {
		data,
		yFormat,
		xFormat,
		colors,
		label
	}: {
		data: { month: string; tags: { tagId: string | null; name: string; total: number }[] }[];
		yFormat: (n: number) => string;
		xFormat: (month: string) => string;
		colors: Record<string, string>;
		label?: string;
	} = $props();

	// Measured container width keeps viewBox units equal to CSS pixels, so
	// tick labels render at their authored 11px instead of stretching with
	// the card (a fixed 400-unit viewBox scaled type up ~2x on wide screens).
	let chartWidth = $state(400);
	const chartHeight = 200;
	const margin = { top: 10, right: 10, bottom: 30, left: 50 };
	const minPlotWidth = 280;
	const safeWidth = $derived(Math.max(chartWidth, minPlotWidth));
	const innerWidth = $derived(safeWidth - margin.left - margin.right);
	const innerHeight = chartHeight - margin.top - margin.bottom;

	// Extract all unique tags across all months
	const allTags = $derived(() => {
		const tagMap = new Map<string, string>();
		data.forEach((d) => {
			d.tags.forEach((t) => {
				if (t.tagId !== null) {
					tagMap.set(t.tagId, t.name);
				}
			});
		});
		return Array.from(tagMap.entries()).map(([tagId, name]) => ({ tagId, name }));
	});

	// Transform data for d3 stack: each month becomes an object with tag totals
	const stackData = $derived(() => {
		return data.map((d) => {
			const obj: StackDatum = { month: d.month };
			d.tags.forEach((t) => {
				if (t.tagId !== null) {
					obj[t.tagId] = t.total;
				}
			});
			return obj;
		});
	});

	const xScale = $derived(
		data.length > 0
			? scaleBand()
					.domain(data.map((d) => d.month))
					.range([0, innerWidth])
					.padding(0.1)
			: scaleBand().range([0, innerWidth])
	);

	const yScale = $derived(() => {
		if (data.length === 0) return scaleLinear().range([innerHeight, 0]);

		// Find max stacked value
		let maxTotal = 0;
		data.forEach((d) => {
			const total = d.tags.reduce((sum, t) => sum + (t.tagId !== null ? t.total : 0), 0);
			if (total > maxTotal) maxTotal = total;
		});

		return scaleLinear()
			.domain([0, maxTotal])
			.range([innerHeight, 0]);
	});

	const stackedPaths = $derived(() => {
		if (data.length === 0) return [];

		const tags = allTags();
		if (tags.length === 0) return [];

		const stackGen = stack<StackDatum>()
			.keys(tags.map((t) => t.tagId))
			.value((datum, key) => Number(datum[key] ?? 0))
			.order(null)
			.offset(null);

		const stacked = stackGen(stackData());
		const yScl = yScale();
		const xScl = xScale;

		const areaGen = area<SeriesPoint<StackDatum>>()
			.x((d) => (xScl(d.data.month) ?? 0) + xScl.bandwidth() / 2)
			.y0((d) => yScl(d[0]))
			.y1((d) => yScl(d[1]));

		return stacked.map((series, i) => ({
			tagId: tags[i].tagId,
			name: tags[i].name,
			path: areaGen(series) ?? ''
		}));
	});

	const yTicks = $derived(() => {
		if (data.length === 0) return [];
		return yScale().ticks(5);
	});
</script>

{#if data.length > 0}
	<div bind:clientWidth={chartWidth}>
		<LayerCake data={data} x="month" y="tags">
			<Svg>
				<svg viewBox="0 0 {safeWidth} {chartHeight}" class="stacked-area-chart" role="img" aria-label={label}>
				<g transform="translate({margin.left}, {margin.top})">
					<!-- Stacked areas -->
					{#each stackedPaths() as stackItem}
						<path
							d={stackItem.path}
							style="fill: {colors[stackItem.tagId] ?? 'var(--dim)'}"
							opacity="0.7"
						/>
					{/each}

					<!-- X Axis -->
					<g class="axis x-axis" transform="translate(0, {innerHeight})">
						<line x1={0} y1={0} x2={innerWidth} y2={0} class="axis-line" />
						{#each data as d}
							{@const x = xScale(d.month)}
							{#if x !== undefined}
								<g transform="translate({x + xScale.bandwidth() / 2}, 0)">
									<line y2="6" class="tick-line" />
									<text y="20" class="tick-label">{xFormat(d.month)}</text>
								</g>
							{/if}
						{/each}
					</g>

					<!-- Y Axis -->
					<g class="axis y-axis">
						<line x1={0} y1={0} x2={0} y2={innerHeight} class="axis-line" />
						{#each yTicks() as tick}
							<g transform="translate(0, {yScale()(tick)})">
								<line x2="-6" class="tick-line" />
								<text x="-10" class="tick-label">{yFormat(tick)}</text>
							</g>
						{/each}
					</g>
				</g>
			</svg>
		</Svg>
	</LayerCake>
	</div>

	<!-- Legend -->
	<div class="legend">
		{#each allTags() as tag}
			<div class="legend-item">
				<span class="legend-color" style="background-color: {colors[tag.tagId] ?? 'var(--dim)'}"></span>
				<span class="legend-label">{tag.name}</span>
			</div>
		{/each}
	</div>

	<!-- Non-visual readers get the actual data, not just the chart's name. -->
	{#if label}
		<table class="sr-only">
			<caption>{label}</caption>
			<thead>
				<tr>
					<th scope="col">{m.chart_col_period()}</th>
					<th scope="col">{m.reports_category()}</th>
					<th scope="col">{m.chart_col_amount()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data as d}
					{#each d.tags as t}
						<tr>
							<th scope="row">{xFormat(d.month)}</th>
							<td>{t.name}</td>
							<td>{yFormat(t.total)}</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	.stacked-area-chart {
		display: block;
		width: 100%;
		height: auto;
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
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-variant-numeric: tabular-nums lining-nums;
		letter-spacing: -0.01em;
		font-size: 11px;
		text-anchor: middle;
	}

	.y-axis .tick-label {
		text-anchor: end;
		dominant-baseline: middle;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-top: 0.5rem;
		justify-content: center;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 11px;
	}

	.legend-color {
		width: 12px;
		height: 12px;
		border-radius: 2px;
	}

	.legend-label {
		color: var(--dim);
	}
</style>
