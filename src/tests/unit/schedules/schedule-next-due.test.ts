import { describe, it, expect } from 'vitest';
import { nextDueDate, firstDueOnOrAfter } from '$lib/utils/schedule_next_due';

describe('nextDueDate', () => {
	it('advances weekly by 7 days and biweekly by 14', () => {
		expect(nextDueDate('2026-01-01', 'weekly')).toBe('2026-01-08');
		expect(nextDueDate('2026-01-01', 'biweekly')).toBe('2026-01-15');
	});

	it('carries a weekly step across a month and a year boundary', () => {
		expect(nextDueDate('2026-01-28', 'weekly')).toBe('2026-02-04');
		expect(nextDueDate('2026-12-28', 'weekly')).toBe('2027-01-04');
	});

	it('advances monthly to the same day next month', () => {
		expect(nextDueDate('2026-03-15', 'monthly')).toBe('2026-04-15');
		expect(nextDueDate('2026-12-15', 'monthly')).toBe('2027-01-15');
	});

	it('clamps a monthly step to the last day of a short month', () => {
		// January 31 has no February counterpart; the step clamps to month end.
		expect(nextDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
		expect(nextDueDate('2024-01-31', 'monthly')).toBe('2024-02-29'); // leap year
		expect(nextDueDate('2026-03-31', 'monthly')).toBe('2026-04-30');
	});

	it('advances yearly to the same month and day', () => {
		expect(nextDueDate('2026-07-04', 'yearly')).toBe('2027-07-04');
	});

	it('clamps a yearly step onto a leap day', () => {
		expect(nextDueDate('2024-02-29', 'yearly')).toBe('2025-02-28');
	});

	it('multiplies by the interval', () => {
		expect(nextDueDate('2026-01-01', 'weekly', 3)).toBe('2026-01-22');
		expect(nextDueDate('2026-01-15', 'monthly', 3)).toBe('2026-04-15');
		expect(nextDueDate('2026-01-15', 'yearly', 2)).toBe('2028-01-15');
	});

	it('is pure — the same input always yields the same output', () => {
		expect(nextDueDate('2026-01-31', 'monthly')).toBe(nextDueDate('2026-01-31', 'monthly'));
	});
});

describe('firstDueOnOrAfter', () => {
	it('returns the anchor unchanged when it is already today or later', () => {
		expect(firstDueOnOrAfter('2026-06-01', 'monthly', '2026-06-01')).toBe('2026-06-01');
		expect(firstDueOnOrAfter('2026-07-01', 'monthly', '2026-06-01')).toBe('2026-07-01');
	});

	it('skips forward past a disabled period instead of replaying it', () => {
		// Disabled from January to June: re-enabling must not post five months of rent.
		expect(firstDueOnOrAfter('2026-01-31', 'monthly', '2026-06-01')).toBe('2026-06-28');
		expect(firstDueOnOrAfter('2026-01-01', 'weekly', '2026-01-10')).toBe('2026-01-15');
	});

	it('clamps across a short month while skipping', () => {
		expect(firstDueOnOrAfter('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28');
	});

	it('gives up rather than looping forever on an unreachable date', () => {
		// 1000 weekly steps is ~19 years; past that the caller keeps the stored date.
		expect(firstDueOnOrAfter('1970-01-01', 'weekly', '2100-01-01')).toBeNull();
	});
});
