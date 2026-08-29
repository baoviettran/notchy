/**
 * Pure transaction transforms, extracted from stores/transactions.svelte.ts.
 *
 * `monthDateRange` computes the UTC bounding dates of a month (the query
 * window for the dashboard's monthly-flow figure); `flowSum` totals
 * income-minus-expense while ignoring transfer/reconciliation rows. Both were
 * inline inside a $state() rune where Istanbul could not measure them; the
 * day-boundary and empty-flow branches were untested.
 */

/** A transaction's month-flow contribution (kind + amount). */
export interface FlowItem {
	kind: string;
	amount: number;
}

/**
 * First and last day of the UTC month containing `now`, as YYYY-MM-DD.
 * Uses UTC components so the window is stable regardless of the device timezone.
 */
export function monthDateRange(now: Date): { dateFrom: string; dateTo: string } {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const dateFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
	// Day 0 of the next month is the last day of this one.
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const dateTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
	return { dateFrom, dateTo };
}

/**
 * Income minus expense, ignoring every other kind (transfer, adjustment, etc).
 * Returns 0 for an empty/fully-ignored list — a successful month with no flow.
 */
export function flowSum(items: FlowItem[]): number {
	return items
		.filter((t) => t.kind === 'income' || t.kind === 'expense')
		.reduce((s, t) => s + (t.kind === 'income' ? t.amount : -t.amount), 0);
}