import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/budgets';
import * as catRepo from '$lib/db/repos/categories';
import type { DatabaseService } from '$lib/db';

let db: DatabaseService;
const NOW = new Date().toISOString();

async function seedExpense(tagId: string, amount: number, date: string) {
	const { ulid } = await import('$lib/utils/id');
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, 'expense', ?, ?, 'acc1', ?, ?, ?)`,
		[ulid(), date, amount, tagId, NOW, NOW]
	);
}

async function seedIncome(amount: number, date: string) {
	const { ulid } = await import('$lib/utils/id');
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, 'income', ?, ?, 'acc1', NULL, ?, ?)`,
		[ulid(), date, amount, NOW, NOW]
	);
}

async function seedRefund(tagId: string, amount: number, date: string) {
	const { ulid } = await import('$lib/utils/id');
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, 'refund', ?, ?, 'acc1', ?, ?, ?)`,
		[ulid(), date, amount, tagId, NOW, NOW]
	);
}

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	await db.execute(
		`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('acc1', 'Test', 'checking', 'VND', ?, ?)`,
		[NOW, NOW]
	);
});

describe('setAllocation', () => {
	it('creates a budget allocation', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-05', 15000000);
		const budgets = await repo.getBudgetsForMonth(db, '2026-05');
		expect(budgets).toHaveLength(1);
		expect(budgets[0].allocated).toBe(15000000);
	});

	it('updates existing allocation', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-05', 10000000);
		await repo.setAllocation(db, 'bucket_essentials', '2026-05', 15000000);
		const budgets = await repo.getBudgetsForMonth(db, '2026-05');
		expect(budgets).toHaveLength(1);
		expect(budgets[0].allocated).toBe(15000000);
	});
});

describe('getSpentForBucket', () => {
	it('sums expenses and nets refunds', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 50000, '2026-05-10');
		await seedExpense(tagId, 30000, '2026-05-15');

		// Add a refund
		const { ulid } = await import('$lib/utils/id');
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
			 VALUES (?, 'refund', '2026-05-16', 10000, 'acc1', ?, ?, ?)`,
			[ulid(), tagId, NOW, NOW]
		);

		const spent = await repo.getSpentForBucket(db, 'bucket_essentials', '2026-05');
		expect(spent).toBe(70000); // 50k + 30k - 10k
	});

	it('excludes transfers', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 50000, '2026-05-10');

		const spent = await repo.getSpentForBucket(db, 'bucket_essentials', '2026-05');
		expect(spent).toBe(50000);
	});
});

describe('copyFromPreviousMonth', () => {
	it('copies allocations from previous month', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 15000000);
		await repo.setAllocation(db, 'bucket_learning', '2026-04', 5000000);

		await repo.copyFromPreviousMonth(db, '2026-05');

		const budgets = await repo.getBudgetsForMonth(db, '2026-05');
		expect(budgets).toHaveLength(2);
		expect(budgets.find((b) => b.type_id === 'bucket_essentials')?.allocated).toBe(15000000);
	});
});

describe('getBudgetsForMonth', () => {
	it('returns summary with spent and remaining', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-05', 15000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 5000000, '2026-05-10');

		const budgets = await repo.getBudgetsForMonth(db, '2026-05');
		expect(budgets[0].spent).toBe(5000000);
		expect(budgets[0].remaining).toBe(10000000);
	});
});

describe('getBudgetsForMonth — roll-over aware', () => {
	it('available = allocated + rolledOver - spent when rollover enabled (default)', async () => {
		// Prior month surplus of 600,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 400000, '2026-03-10');

		// This month: allocated 1,000,000, spent 300,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);
		await seedExpense(tagId, 300000, '2026-04-10');

		const budgets = await repo.getBudgetsForMonth(db, '2026-04');
		const b = budgets.find((x) => x.type_id === 'bucket_essentials')!;
		expect(b.rolled_over).toBe(600000);
		expect(b.spent).toBe(300000);
		expect(b.available).toBe(1300000); // 1,000,000 + 600,000 - 300,000
		expect(b.remaining).toBe(700000); // back-compat: allocated - spent
	});

	it('available = allocated + rolled_over - spent when rollover disabled', async () => {
		// Prior month surplus that a rollover-OFF bucket now carries as a floor.
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 400000, '2026-03-10'); // surplus 600,000

		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);

		// This month: allocated 1,000,000, spent 300,000.
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);
		await seedExpense(tagId, 300000, '2026-04-10');

		const budgets = await repo.getBudgetsForMonth(db, '2026-04');
		const b = budgets.find((x) => x.type_id === 'bucket_essentials')!;
		expect(b.rolled_over).toBe(600000); // the floor carries a positive surplus
		expect(b.available).toBe(1300000); // 1,000,000 + 600,000 - 300,000
	});
});

describe('getRolledOver', () => {
	it('returns 0 for the first budgeted month (no prior history)', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-03');
		expect(rolled).toBe(0);
	});

		it('carries a running floor (not a per-month sum) when rollover is disabled', async () => {
			// Counterexample fixture — same numbers as the Rust
			// rollover_off_carry_is_a_running_floor test:
			//   M1 2026-01: income 100, allocated 100, spent 0    -> carry 0
			//   M2 2026-02: income 150, allocated 0,   spent 150  -> carry 100
			//   M3 2026-03: income 0,   allocated 0,   spent 0    -> carry 0 (floor)
			await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
			const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
			await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
			await seedExpense(tagId, 150000, '2026-02-10');
			await repo.setAllocation(db, 'bucket_essentials', '2026-03', 0);

			await db.execute(
				`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
			);

			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-01')).toBe(0);
			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-02')).toBe(100000);
			// Running floor: max(0, max(0, 0 + 100,000) - 150,000) = 0.
			// A per-month sum would return 100,000 - 150,000 = -50,000.
			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(0);
		});

		it('keeps the full carry (negative included) when rollover is enabled', async () => {
			await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
			const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
			await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
			await seedExpense(tagId, 150000, '2026-02-10');

			// Flag left at the default 1.
			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(-50000);
		});

		// Browser twin of the Rust
		// rollover_off_carry_floors_per_iteration_not_as_a_final_clamp: the
		// counterexample above is surplus-then-overspend (Σ −50), which yields 0
		// under BOTH the per-iteration floor and a lazy end-of-fold `max(0, rolled)`
		// clamp. This is the discriminating ordering — overspend first, then
		// surplus — where the floor gives 100,000 and a final-only clamp gives 0.
		//   M1 2026-01: allocated 0,     spent 300,000 -> L = -300,000, floor -> 0
		//   M2 2026-02: allocated 100,000, spent 0     -> L = +100,000, floor -> 100,000
		it('applies the floor per iteration, not as a single final clamp', async () => {
			await repo.setAllocation(db, 'bucket_essentials', '2026-01', 0);
			const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
			await seedExpense(tagId, 300000, '2026-01-10');
			await repo.setAllocation(db, 'bucket_essentials', '2026-02', 100000);

			await db.execute(
				`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
			);

			// Overspend first: M1's -300,000 is floored to 0.
			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-02')).toBe(0);
			// Surplus second: M2's +100,000 survives; a final clamp would give 0.
			expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(100000);
		});

	it('sums surplus (allocated - spent) across prior budgeted months', async () => {
		// 2026-03: allocated 1,000,000, spent 400,000 → surplus 600,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 400000, '2026-03-10');

		// 2026-04: allocated 1,000,000, spent 1,000,000 → surplus 0
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);
		await seedExpense(tagId, 1000000, '2026-04-10');

		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-05');
		expect(rolled).toBe(600000); // 600,000 + 0
	});

	it('goes negative when overspent (deficit rolls forward)', async () => {
		// 2026-03: allocated 500,000, spent 800,000 → deficit -300,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 500000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 800000, '2026-03-10');

		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-04');
		expect(rolled).toBe(-300000);
	});

	it('ignores spending in months that have no budget row (budget-row gating)', async () => {
		// 2026-03: spending but NO allocation → ignored
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 999999, '2026-03-10');

		// 2026-04: first budget row, allocated 1,000,000, spent 200,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);
		await seedExpense(tagId, 200000, '2026-04-10');

		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-05');
		expect(rolled).toBe(800000); // only April contributes; March ignored
	});

	it('nets refunds in a prior month (refund reduces spent)', async () => {
		// 2026-03: allocated 1,000,000, expense 500,000, refund 100,000 → spent 400,000 → surplus 600,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 500000, '2026-03-10');
		await seedRefund(tagId, 100000, '2026-03-15');

		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-04');
		expect(rolled).toBe(600000);
	});

	it('preserves cumulative balance across a zero-activity budgeted month', async () => {
		// 2026-03: allocated 1,000,000, spent 0 → surplus 1,000,000
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);

		// 2026-04: allocated 1,000,000, spent 0 → surplus 1,000,000 (cumulative now 2,000,000)
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);

		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-05');
		expect(rolled).toBe(2000000);
	});
});

describe('getToBudget', () => {
	it('conserves on the counterexample fixture (rollover off)', async () => {
		// Same table as the Rust to_budget_fold_conserves_on_the_counterexample:
		//   M1 2026-01: income 100, allocated 100, spent 0    toBudget 0
		//   M2 2026-02: income 150, allocated 0,   spent 150  toBudget 150
		//   M3 2026-03: income 0,   allocated 0,   spent 0    toBudget 100
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);
		await seedIncome(100000, '2026-01-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedIncome(150000, '2026-02-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
		await seedExpense(tagId, 150000, '2026-02-10');
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 0);

		const m1 = await repo.getToBudget(db, '2026-01');
		expect(m1).toEqual({
			income: 100000, carried_forward: 0, last_month_overspent: 0,
			assigned: 100000, to_budget: 0, overassigned: 0
		});

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.income).toBe(150000);
		expect(m2.carried_forward).toBe(0);
		expect(m2.last_month_overspent).toBe(0);
		expect(m2.to_budget).toBe(150000);

		const m3 = await repo.getToBudget(db, '2026-03');
		expect(m3.income).toBe(0);
		expect(m3.carried_forward).toBe(150000);
		expect(m3.last_month_overspent).toBe(-50000);
		expect(m3.assigned).toBe(0);
		expect(m3.to_budget).toBe(100000);
		expect(m3.overassigned).toBe(0);

		// Σ available + toBudget is 100,000 in every month.
		for (const [month, expectedAvailable] of [
			['2026-01', 100000], ['2026-02', -50000], ['2026-03', 0]
		] as const) {
			const b = (await repo.getBudgetsForMonth(db, month))
				.find((x) => x.type_id === 'bucket_essentials')!;
			expect(b.available).toBe(expectedAvailable);
			expect(b.available + (await repo.getToBudget(db, month)).to_budget).toBe(100000);
		}
	});

	it('carries a negative pool into the next month without clamping', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		const m1 = await repo.getToBudget(db, '2026-01');
		expect(m1.to_budget).toBe(-100000);
		expect(m1.overassigned).toBe(100000);

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.carried_forward).toBe(-100000);
		expect(m2.to_budget).toBe(-100000);
		expect(m2.overassigned).toBe(100000);
	});

	it('claws back only rollover-off buckets with a prior-month row', async () => {
		// bucket_essentials: rollover OFF, overspent by 200,000 in 2026-01.
		const aTag = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedExpense(aTag, 300000, '2026-01-15');

		// bucket_learning: rollover ON (default), overspent by 200,000 in 2026-01.
		const bTag = await catRepo.createTag(db, 'Books', 'bucket_learning');
		await repo.setAllocation(db, 'bucket_learning', '2026-01', 100000);
		await seedExpense(bTag, 300000, '2026-01-15');

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.last_month_overspent).toBe(-200000);
	});

	it('returns zeros for an empty ledger', async () => {
		expect(await repo.getToBudget(db, '2026-05')).toEqual({
			income: 0, carried_forward: 0, last_month_overspent: 0,
			assigned: 0, to_budget: 0, overassigned: 0
		});
	});

	// Browser twin of the Rust every_intervening_month_is_folded_without_a_budget_row:
	//   Jan: income 100, alloc 100, spent 150 -> Feb carry: lmo = -50, toBudget -50
	//   Feb: (no budgets row, no income)      -> folds -50 into the carry
	//   Mar: target                           -> carried_forward -50, not 0
	// A fold keyed off "months with a budgets row" would skip February and
	// report 0 for both fields — this test is the only guard for "every
	// intervening calendar month" on the adapter Vitest and Playwright drive.
	it('folds every intervening month even without a budget row', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);

		// January: income 100,000, allocated 100,000, spent 150,000 -> overspent by 50,000.
		await seedIncome(100000, '2026-01-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedExpense(tagId, 150000, '2026-01-15');
		// February deliberately has no budgets row (any bucket) and no income.

		const jan = await repo.getToBudget(db, '2026-01');
		expect(jan.to_budget).toBe(0);

		const feb = await repo.getToBudget(db, '2026-02');
		expect(feb.last_month_overspent).toBe(-50000);
		expect(feb.to_budget).toBe(-50000);

		const mar = await repo.getToBudget(db, '2026-03');
		expect(mar.income).toBe(0);
		expect(mar.assigned).toBe(0);
		expect(mar.carried_forward).toBe(-50000);
		expect(mar.last_month_overspent).toBe(0);
		expect(mar.to_budget).toBe(-50000);
		expect(mar.overassigned).toBe(50000);
	});

	// Browser twin of the Rust pool_start_month_includes_earlier_income:
	// income dated before the first budget row still funds the pool, so the
	// start is the earliest of (first budget month, first income month). This
	// is the only test whose pool start resolves to the income arm of
	// poolStartMonth's UNION — if that arm were broken, every other test would
	// still pass because their income month is ≥ the first budget month.
	it('folds from an income month that precedes the first budget row', async () => {
		// Income in 2025-12, first budget row in 2026-01, requested 2026-01.
		await seedIncome(100000, '2025-12-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 40000);

		const m = await repo.getToBudget(db, '2026-01');
		expect(m.income).toBe(0); // no income *in* January
		expect(m.carried_forward).toBe(100000); // December's income carried forward
		expect(m.last_month_overspent).toBe(0);
		expect(m.assigned).toBe(40000);
		expect(m.to_budget).toBe(60000);
		expect(m.overassigned).toBe(0);
	});

	// Browser twin of the Rust unbudgeted_month_spending_is_ignored: the carry
	// gate is the budget row, and the fold must not start counting a month's
	// activity just because the fold now visits it.
	it('ignores spending in an unbudgeted month', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);

		// 2026-01 funds the bucket; the 150,000 spent in 2026-02 has no budget row.
		await seedIncome(100000, '2026-01-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedExpense(tagId, 150000, '2026-02-10');

		// The carry into 2026-03 is the January surplus (100,000), untouched by
		// the unbudgeted February spend; nothing is clawed back.
		expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(100000);

		const m3 = await repo.getToBudget(db, '2026-03');
		expect(m3.income).toBe(0);
		expect(m3.carried_forward).toBe(0);
		expect(m3.last_month_overspent).toBe(0);
		expect(m3.assigned).toBe(0);
		expect(m3.to_budget).toBe(0);
		expect(m3.overassigned).toBe(0);
	});

	// The fold steps Dec → Jan through nextMonth's `m === 12` wrap, and a month
	// before the pool start returns the all-zero breakdown rather than folding.
	it('folds across a year boundary and rejects a pre-start month', async () => {
		// December 2025: income 100,000, allocated 40,000 → toBudget 60,000.
		await seedIncome(100000, '2025-12-05');
		await repo.setAllocation(db, 'bucket_essentials', '2025-12', 40000);

		// January 2026 is reached only by wrapping nextMonth('2025-12').
		const jan = await repo.getToBudget(db, '2026-01');
		expect(jan).toEqual({
			income: 0, carried_forward: 60000, last_month_overspent: 0,
			assigned: 0, to_budget: 60000, overassigned: 0
		});

		// A month before the pool start (2025-12) is the `start > month` guard.
		expect(await repo.getToBudget(db, '2025-11')).toEqual({
			income: 0, carried_forward: 0, last_month_overspent: 0,
			assigned: 0, to_budget: 0, overassigned: 0
		});
	});
});
