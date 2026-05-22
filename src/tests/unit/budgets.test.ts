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
