import { describe, it, expect } from 'vitest';
import { reportSeriesColors, seriesColor } from '../../lib/utils/palette';

describe('report series palette', () => {
	it('references design-system tokens, never raw hexes', () => {
		expect(reportSeriesColors.length).toBeGreaterThanOrEqual(4);
		for (const color of reportSeriesColors) {
			expect(color).toMatch(/^var\(--[a-z][a-z-]*\)$/);
		}
	});

	it('returns a token reference for any index', () => {
		expect(seriesColor(0)).toBe(reportSeriesColors[0]);
		expect(seriesColor(3)).toBe(reportSeriesColors[3]);
	});

	it('cycles and tolerates negative indices', () => {
		expect(seriesColor(reportSeriesColors.length)).toBe(reportSeriesColors[0]);
		expect(seriesColor(-1)).toBe(reportSeriesColors[reportSeriesColors.length - 1]);
	});
});
