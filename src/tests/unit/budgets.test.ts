import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/budgets';
import * as catRepo from '$lib/db/repos/categories';
import type { DatabaseService } from '$lib/db/service';

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

describe('getRolledOver', () => {
	it('returns 0 for the first budgeted month (no prior history)', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const rolled = await repo.getRolledOver(db, 'bucket_essentials', '2026-03');
		expect(rolled).toBe(0);
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
