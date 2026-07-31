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

	it('excludes Adjustments-bucket transactions from totals by default', async () => {
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedTx('expense', 1000000, '2026-05-10', tagId);
		// Reconciliation expense (tagged in Adjustments bucket)
		await seedTx('expense', 500000, '2026-05-11', 'tag_reconciliation');

		const report = await reports.getOverview(db, '2026-05');
		expect(report.total_expense).toBe(1000000); // reconciliation excluded

		const reportWithAdj = await reports.getOverview(db, '2026-05', true);
		expect(reportWithAdj.total_expense).toBe(1500000); // included
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

describe('getNetWorthSeries', () => {
	function fmtMonth(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
	}

	function midOfMonth(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-15`;
	}

	it('returns cumulative net worth over N months (most recent first)', async () => {
		const now = new Date();
		const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
		const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 15);

		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'income', midOfMonth(twoMonthsAgo), 5000000, 'acc1', NOW, NOW]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'income', midOfMonth(oneMonthAgo), 3000000, 'acc1', NOW, NOW]
		);

		const series = await reports.getNetWorthSeries(db, 3);
		expect(series).toHaveLength(3);
		// Most recent first
		expect(series[0].month).toBe(fmtMonth(now));
		expect(series[2].month).toBe(fmtMonth(twoMonthsAgo));
		// Cumulative: latest month should have all income
		expect(series[0].netWorth).toBe(8000000);
	});

	it('transfer between own accounts is flat (net-neutral)', async () => {
		const now = new Date();
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('acc2', 'Savings', 'savings', 'VND', ?, ?)`,
			[NOW, NOW]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'transfer', midOfMonth(now), 1000000, 'acc1', 'acc2', 'tp1', NOW, NOW]
		);

		const series = await reports.getNetWorthSeries(db, 1);
		expect(series).toHaveLength(1);
		// Transfer: acc1 loses 1M, acc2 gains 1M, net = 0
		expect(series[0].netWorth).toBe(0);
	});

	it('excludes deleted transactions', async () => {
		const now = new Date();
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'income', midOfMonth(now), 5000000, 'acc1', NOW, NOW, NOW]
		);

		const series = await reports.getNetWorthSeries(db, 1);
		expect(series).toHaveLength(1);
		expect(series[0].netWorth).toBe(0);
	});

	it('includes archived accounts', async () => {
		const now = new Date();
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at, deleted_at) VALUES ('acc_archived', 'Old Account', 'checking', 'VND', ?, ?, ?)`,
			[NOW, NOW, NOW]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'income', midOfMonth(now), 2000000, 'acc_archived', NOW, NOW]
		);

		const series = await reports.getNetWorthSeries(db, 1);
		expect(series).toHaveLength(1);
		expect(series[0].netWorth).toBe(2000000);
	});

	it('returns negative net worth when liabilities exceed assets', async () => {
		const now = new Date();
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('acc_cc', 'Credit Card', 'credit_card', 'VND', ?, ?)`,
			[NOW, NOW]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[ulid(), 'expense', midOfMonth(now), 3000000, 'acc_cc', NOW, NOW]
		);

		const series = await reports.getNetWorthSeries(db, 1);
		expect(series).toHaveLength(1);
		expect(series[0].netWorth).toBe(-3000000);
	});

	it('returns all zeros for empty database', async () => {
		const series = await reports.getNetWorthSeries(db, 3);
		expect(series).toHaveLength(3);
		series.forEach((point) => {
			expect(point.netWorth).toBe(0);
		});
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
