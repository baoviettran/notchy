import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/db', () => ({ getDb: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ mapError: vi.fn(() => 'Something went wrong') }));

import { getDb } from '$lib/db';
import { budgets } from '$lib/stores/budgets.svelte';

const POOL = {
	income: 500000, carried_forward: 0, last_month_overspent: -200000,
	assigned: 100000, to_budget: 200000, overassigned: 0
};

describe('BudgetsStore.load', () => {
	beforeEach(() => vi.clearAllMocks());

	it('populates toBudget from db.budgets.getToBudget alongside items', async () => {
		const db = {
			budgets: {
				getForMonth: vi.fn().mockResolvedValue([]),
				getToBudget: vi.fn().mockResolvedValue(POOL),
				hasAllocations: vi.fn().mockResolvedValue(false)
			}
		};
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		await budgets.load('2026-08');

		expect(db.budgets.getToBudget).toHaveBeenCalledWith('2026-08');
		expect(budgets.toBudget).toEqual(POOL);
	});
});
