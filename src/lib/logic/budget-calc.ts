/**
 * Pure budget helpers, extracted from stores/budgets.svelte.ts.
 *
 * `monthKey` formats a date as the YYYY-MM key used to load a month's
 * budget allocations. Extracted so it is unit-testable (the original wrote
 * `new Date()` inline in the store); the injected date keeps it pure.
 */

/** Format `d` as YYYY-MM (month is zero-based, so +1, zero-padded). */
export function monthKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}