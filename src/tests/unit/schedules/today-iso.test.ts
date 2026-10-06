import { describe, it, expect } from 'vitest';
import { todayIso } from '$lib/utils/date';

describe('todayIso', () => {
	it('formats the given instant as a UTC ISO calendar date', () => {
		expect(todayIso(new Date('2026-10-03T23:30:00Z'))).toBe('2026-10-03');
	});

	it('pads single-digit months and days', () => {
		expect(todayIso(new Date('2026-01-04T12:00:00Z'))).toBe('2026-01-04');
	});

	it('is a pure function of its argument', () => {
		const at = new Date('2026-06-15T00:00:00Z');
		expect(todayIso(at)).toBe(todayIso(at));
	});
});
