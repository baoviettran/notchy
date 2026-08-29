/**
 * Characterization tests for src/lib/logic/budget-calc.ts.
 *
 * Extracted from stores/budgets.svelte.ts currentMonth(): the YYYY-MM month
 * key used to load budget allocations. Originally wrote `new Date()` inline
 * inside the store (untestable); now pure with an injected date.
 *
 * NOTE: the key uses `getFullYear()`/`getMonth()` — LOCAL components — byte-
 * identical to the original store. Tests therefore construct dates with the
 * local `new Date(y, m, d)` form so they read intended calendar values in any
 * timezone (a UTC ISO string can cross a zone boundary and flake in CI).
 */
import { describe, it, expect } from 'vitest';
import { monthKey } from '$lib/logic/budget-calc';

describe('monthKey', () => {
	it('formats a month as YYYY-MM with a zero-padded month', () => {
		expect(monthKey(new Date(2026, 7, 5))).toBe('2026-08');
	});

	it('zero-pads single-digit months', () => {
		expect(monthKey(new Date(2026, 2, 5))).toBe('2026-03');
	});

	it('uses the zero-based getMonth() correctly for January (0 -> 01)', () => {
		expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01');
	});

	it('uses the zero-based getMonth() correctly for December (11 -> 12)', () => {
		expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12');
	});

	it('carries the year across a boundary', () => {
		expect(monthKey(new Date(2025, 11, 31, 23, 59))).toBe('2025-12');
	});

	it('uses the full four-digit year', () => {
		expect(monthKey(new Date(2099, 6, 1))).toBe('2099-07');
	});
});