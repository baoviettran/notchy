import { describe, expect, it } from 'vitest';
import { nextBudgetableId, monthStepFromKey } from '$lib/utils/budgets';

const buckets = [
	{ id: 'a', budgetable: 1 },
	{ id: 'b', budgetable: 0 },
	{ id: 'c', budgetable: 1 },
	{ id: 'd', budgetable: 1 }
];

describe('nextBudgetableId', () => {
	it('chains to the next budgetable bucket, skipping non-budgetable', () => {
		expect(nextBudgetableId(buckets, 'a')).toBe('c');
		expect(nextBudgetableId(buckets, 'c')).toBe('d');
	});

	it('returns null after the last bucket', () => {
		expect(nextBudgetableId(buckets, 'd')).toBeNull();
	});
});

describe('monthStepFromKey', () => {
	it('monthStepFromKey maps arrows only', () => {
		expect(monthStepFromKey('ArrowLeft')).toBe(-1);
		expect(monthStepFromKey('ArrowRight')).toBe(1);
		expect(monthStepFromKey('ArrowDown')).toBe(0);
	});
});
