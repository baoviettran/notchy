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

	it('ignores a stale month load that resolves after a newer one', async () => {
		const august = { ...POOL, to_budget: 111 };
		const september = { ...POOL, to_budget: 999 };
		let resolveAugust!: (pool: typeof POOL) => void;
		const db = {
			budgets: {
				getForMonth: vi.fn().mockResolvedValue([]),
				getToBudget: vi
					.fn()
					// August's fold hangs; September's resolves immediately.
					.mockImplementationOnce(() => new Promise((r) => { resolveAugust = r; }))
					.mockResolvedValueOnce(september),
				hasAllocations: vi.fn().mockResolvedValue(false)
			}
		};
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		const augustLoad = budgets.load('2026-08');
		const septemberLoad = budgets.load('2026-09');
		await septemberLoad;

		// The superseded August fold now lands — it must not overwrite September.
		resolveAugust(august);
		await augustLoad;

		expect(budgets.month).toBe('2026-09');
		expect(budgets.toBudget).toEqual(september);
	});
});
