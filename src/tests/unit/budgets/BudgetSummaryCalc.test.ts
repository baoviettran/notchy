import { describe, it, expect } from 'vitest';
import type { BudgetSummary } from '$lib/db/client';

/**
 * Budget summary calculations — extracted for testability.
 * The budgets page derives these from budgets.items and monthIncome.
 */

function computeSummary(items: BudgetSummary[], monthIncome: number) {
	const totalAllocated = items.reduce((s, b) => s + b.allocated, 0);
	const totalSpent = items.reduce((s, b) => s + b.spent, 0);
	const totalAvailable = items.reduce((s, b) => s + (b.available ?? b.allocated - b.spent), 0);
	const remainingToAllocate = Math.max(0, monthIncome - totalAllocated);
	const overAmount = Math.max(0, totalAllocated - monthIncome);
	return { totalAllocated, totalSpent, totalAvailable, remainingToAllocate, overAmount };
}

function isUnbudgeted(item: BudgetSummary): boolean {
	return item.allocated === 0 && item.spent === 0;
}

describe('budget summary calculations', () => {
	const items: BudgetSummary[] = [
		{ type_id: 'a', month: '2026-08', allocated: 50000, spent: 30000, remaining: 20000, available: 20000, rolled_over: 0 },
		{ type_id: 'b', month: '2026-08', allocated: 30000, spent: 35000, remaining: -5000, available: -5000, rolled_over: 0 },
		{ type_id: 'c', month: '2026-08', allocated: 0, spent: 0, remaining: 0, available: 0, rolled_over: 0 }
	];

	it('sums allocated across all buckets', () => {
		const { totalAllocated } = computeSummary(items, 100000);
		expect(totalAllocated).toBe(80000);
	});

	it('sums spent across all buckets', () => {
		const { totalSpent } = computeSummary(items, 100000);
		expect(totalSpent).toBe(65000);
	});

	it('sums available (including negative)', () => {
		const { totalAvailable } = computeSummary(items, 100000);
		expect(totalAvailable).toBe(15000);
	});

	it('computes remainingToAllocate as income minus allocated', () => {
		const { remainingToAllocate } = computeSummary(items, 100000);
		expect(remainingToAllocate).toBe(20000);
	});

	it('remainingToAllocate floors at zero when over budget', () => {
		const { remainingToAllocate } = computeSummary(items, 50000);
		expect(remainingToAllocate).toBe(0);
	});

	it('computes overAmount when allocated exceeds income', () => {
		const { overAmount } = computeSummary(items, 50000);
		expect(overAmount).toBe(30000);
	});

	it('overAmount is zero when within budget', () => {
		const { overAmount } = computeSummary(items, 200000);
		expect(overAmount).toBe(0);
	});

	it('handles empty items list', () => {
		const s = computeSummary([], 100000);
		expect(s.totalAllocated).toBe(0);
		expect(s.totalSpent).toBe(0);
		expect(s.totalAvailable).toBe(0);
		expect(s.remainingToAllocate).toBe(100000);
		expect(s.overAmount).toBe(0);
	});
});

describe('isUnbudgeted', () => {
	it('returns true when allocated and spent are both zero', () => {
		expect(isUnbudgeted({ type_id: 'x', month: '2026-08', allocated: 0, spent: 0, remaining: 0, available: 0, rolled_over: 0 })).toBe(true);
	});

	it('returns false when allocated is nonzero', () => {
		expect(isUnbudgeted({ type_id: 'x', month: '2026-08', allocated: 100, spent: 0, remaining: 100, available: 100, rolled_over: 0 })).toBe(false);
	});

	it('returns false when spent is nonzero', () => {
		expect(isUnbudgeted({ type_id: 'x', month: '2026-08', allocated: 0, spent: 50, remaining: -50, available: -50, rolled_over: 0 })).toBe(false);
	});
});
