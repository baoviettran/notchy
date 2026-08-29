/**
 * Characterization tests for src/lib/logic/tx-transform.ts.
 *
 * Extracted from stores/transactions.svelte.ts loadMonthFlow: the UTC month
 * bounding-date math and the income/expense flow sum. These were inline in a
 * $state() rune, unmeasured by Istanbul; the day-boundary branches (31-day
 * months, Feb, leap-year Feb, year rollover) are exactly the kind the global
 * 62% branch number was hiding.
 */
import { describe, it, expect } from 'vitest';
import { monthDateRange, flowSum } from '$lib/logic/tx-transform';

describe('monthDateRange', () => {
	it('returns the UTC month bounds for a mid-month date', () => {
		expect(monthDateRange(new Date('2026-08-15T12:00:00Z'))).toEqual({
			dateFrom: '2026-08-01',
			dateTo: '2026-08-31',
		});
	});

	it('handles a 30-day month', () => {
		expect(monthDateRange(new Date('2026-04-10T00:00:00Z'))).toEqual({
			dateFrom: '2026-04-01',
			dateTo: '2026-04-30',
		});
	});

	it('handles February in a non-leap year (28 days)', () => {
		expect(monthDateRange(new Date('2026-02-01T00:00:00Z'))).toEqual({
			dateFrom: '2026-02-01',
			dateTo: '2026-02-28',
		});
	});

	it('handles February in a leap year (29 days)', () => {
		expect(monthDateRange(new Date('2028-02-15T00:00:00Z'))).toEqual({
			dateFrom: '2028-02-01',
			dateTo: '2028-02-29',
		});
	});

	it('pads single-digit month and day with a leading zero', () => {
		expect(monthDateRange(new Date('2026-03-05T00:00:00Z'))).toEqual({
			dateFrom: '2026-03-01',
			dateTo: '2026-03-31',
		});
	});

	it('rolls over across a year boundary (December -> January)', () => {
		expect(monthDateRange(new Date('2026-12-20T00:00:00Z'))).toEqual({
			dateFrom: '2026-12-01',
			dateTo: '2026-12-31',
		});
	});

	it('uses UTC components, not the local wall clock', () => {
		// 01 Mar 02:00 +08:00 is 28 Feb 18:00 UTC — the month key is February.
		// A locale-aware implementation would read March and return the wrong range.
		expect(monthDateRange(new Date('2026-03-01T02:00:00+08:00'))).toEqual({
			dateFrom: '2026-02-01',
			dateTo: '2026-02-28',
		});
	});
});

describe('flowSum', () => {
	it('sums income minus expense, ignoring transfers and other kinds', () => {
		const items = [
			{ kind: 'income', amount: 10000 },
			{ kind: 'expense', amount: 4000 },
			{ kind: 'transfer', amount: 99999 }, // must be ignored
			{ kind: 'income', amount: 2000 },
		];
		expect(flowSum(items)).toBe(8000);
	});

	it('returns 0 for an empty list (a successful month with no flow prints 0, not null)', () => {
		expect(flowSum([])).toBe(0);
	});

	it('returns a negative flow when expenses exceed income', () => {
		const items = [
			{ kind: 'income', amount: 1000 },
			{ kind: 'expense', amount: 8000 },
		];
		expect(flowSum(items)).toBe(-7000);
	});

	it('returns a positive flow when income-only', () => {
		expect(flowSum([{ kind: 'income', amount: 50000 }])).toBe(50000);
	});

	it('returns a negative flow when expense-only', () => {
		expect(flowSum([{ kind: 'expense', amount: 3000 }])).toBe(-3000);
	});
});