// Categorical ramp built from the Adding Machine tokens (app.css). Charts never
// carry raw hexes — colors reference the CSS variables so the ramp flips with
// html.light / html.dark like every other surface. Values are CSS var()
// strings; SVG fills/strokes take them via the style attribute (presentation
// attributes cannot resolve var()).
export const reportSeriesColors = [
	'var(--phosphor)',
	'var(--debit)',
	'var(--phosphor-bright)',
	'var(--dim)',
	'var(--line)',
	'var(--ledger)'
] as const;

export function seriesColor(index: number): string {
	const n = reportSeriesColors.length;
	return reportSeriesColors[((index % n) + n) % n];
}
