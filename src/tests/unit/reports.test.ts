import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as reports from '$lib/db/repos/reports';
import * as catRepo from '$lib/db/repos/categories';
import type { DatabaseService } from '$lib/db/service';
import { ulid } from '$lib/utils/id';

let db: DatabaseService;
const NOW = new Date().toISOString();

async function seedTx(kind: string, amount: number, date: string, tagId?: string) {
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'acc1', ?, ?, ?)`,
		[ulid(), kind, date, amount, tagId ?? null, NOW, NOW]
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

describe('getOverview', () => {
	it('computes income, expense, net cash flow', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedTx('income', 10000000, '2026-05-01');
		await seedTx('expense', 3000000, '2026-05-10', tagId);
		await seedTx('refund', 500000, '2026-05-12', tagId);

		const report = await reports.getOverview(db, '2026-05');
		expect(report.total_income).toBe(10000000);
		expect(report.total_expense).toBe(2500000); // 3M - 500k refund
		expect(report.net_cash_flow).toBe(7500000);
	});

	it('returns spending by bucket', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedTx('expense', 1000000, '2026-05-10', tagId);

		const report = await reports.getOverview(db, '2026-05');
		expect(report.spending_by_bucket).toHaveLength(1);
		expect(report.spending_by_bucket[0].name).toBe('Essentials');
	});
});

describe('getTrend', () => {
	it('returns monthly trend data', async () => {
		await seedTx('expense', 1000000, '2026-05-10');
		await seedTx('income', 5000000, '2026-05-01');

		const trend = await reports.getTrend(db, 6);
		expect(trend).toHaveLength(6);
		const may = trend.find((t) => t.month === '2026-05');
		expect(may?.income).toBe(5000000);
		expect(may?.expense).toBe(1000000);
	});
});

describe('getComparison', () => {
	it('compares two months', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedTx('expense', 1000000, '2026-04-10', tagId);
		await seedTx('expense', 1500000, '2026-05-10', tagId);

		const rows = await reports.getComparison(db, '2026-04', '2026-05');
		expect(rows).toHaveLength(1);
		expect(rows[0].month_a).toBe(1000000);
		expect(rows[0].month_b).toBe(1500000);
		expect(rows[0].change).toBe(500000);
	});
});
