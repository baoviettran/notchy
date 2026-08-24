<script lang="ts">
	import { LayerCake, Svg } from 'layercake';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import * as m from '$lib/paraglide/messages';

	let {
		data,
		yFormat,
		xFormat,
		label
	}: {
		data: { month: string; yearAIncome: number; yearAExpense: number; yearBIncome: number; yearBExpense: number }[];
		yFormat: (n: number) => string;
		xFormat: (month: string) => string;
		label?: string;
	} = $props();

	const chartWidth = 400;
	const chartHeight = 200;
	const margin = { top: 10, right: 10, bottom: 30, left: 50 };
	const innerWidth = chartWidth - margin.left - margin.right;
	const innerHeight = chartHeight - margin.top - margin.bottom;

	const series = ['yearAIncome', 'yearAExpense', 'yearBIncome', 'yearBExpense'];
	// Two inks, two strengths: income is phosphor, expense is debit (the app-wide
	// convention); year B is the same ink at half strength, so "year" reads as
	// intensity rather than a new set of colors.
	const colors: Record<string, string> = {
		yearAIncome: 'var(--phosphor)',
		yearAExpense: 'var(--debit)',
		yearBIncome: 'var(--phosphor)',
		yearBExpense: 'var(--debit)'
	};
	const faded = new Set(['yearBIncome', 'yearBExpense']);
	const labels = {
		yearAIncome: m.reports_legend_year_a_income(),
		yearAExpense: m.reports_legend_year_a_expense(),
		yearBIncome: m.reports_legend_year_b_income(),
		yearBExpense: m.reports_legend_year_b_expense()
	};

	const xScale = $derived(
		data.length > 0
			? scaleBand()
					.domain(data.map((d) => d.month))
					.range([0, innerWidth])
					.padding(0.2)
			: scaleBand().range([0, innerWidth])
	);

	const yScale = $derived(() => {
		if (data.length === 0) return scaleLinear().range([innerHeight, 0]);

		let maxValue = 0;
		data.forEach((d) => {
			const max = Math.max(d.yearAIncome, d.yearAExpense, d.yearBIncome, d.yearBExpense);
			if (max > maxValue) maxValue = max;
		});

		return scaleLinear()
			.domain([0, maxValue])
			.range([innerHeight, 0]);
	});

	const groupedBars = $derived(() => {
		if (data.length === 0) return [];

		const xScl = xScale;
		const yScl = yScale();
		const bandWidth = xScl.bandwidth();
		const barWidth = bandWidth / series.length;

		const bars: Array<{
			x: number;
			y: number;
			width: number;
			height: number;
			fill: string;
			opacity: number;
			key: string;
		}> = [];

		data.forEach((d) => {
			const x0 = xScl(d.month) ?? 0;

			series.forEach((key, i) => {
				const value = d[key as keyof typeof d] as number;
				const barX = x0 + i * barWidth;
				const barY = yScl(value);
				const barHeight = innerHeight - barY;

				bars.push({
					x: barX,
					y: barY,
					width: barWidth,
					height: barHeight,
					fill: colors[key as keyof typeof colors],
					opacity: faded.has(key) ? 0.55 : 1,
					key: `${d.month}-${key}`
				});
			});
		});

		return bars;
	});

	const yTicks = $derived(() => {
		if (data.length === 0) return [];
		return yScale().ticks(5);
	});
</script>

{#if data.length > 0}
	<LayerCake data={data} x="month" y="value">
		<Svg>
			<svg viewBox="0 0 {chartWidth} {chartHeight}" class="grouped-bar-chart" preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
				<g transform="translate({margin.left}, {margin.top})">
					<!-- Bars -->
					{#each groupedBars() as bar}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							style="fill: {bar.fill}"
							opacity={bar.opacity}
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

	<!-- Legend -->
	<div class="legend">
		{#each series as key}
			<div class="legend-item">
				<span class="legend-color" style="background-color: {colors[key as keyof typeof colors]}; opacity: {faded.has(key) ? 0.55 : 1}"></span>
				<span class="legend-label">{labels[key as keyof typeof labels]}</span>
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
					{#each series as key}
						<th scope="col">{labels[key as keyof typeof labels]}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data as d}
					<tr>
						<th scope="row">{xFormat(d.month)}</th>
						{#each series as key}
							<td>{yFormat(d[key as keyof typeof d] as number)}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
{/if}

<style>
	.grouped-bar-chart {
		width: 100%;
		height: 100%;
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
