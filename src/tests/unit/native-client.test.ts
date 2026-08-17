import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri invoke — avoids "window is not defined" in Node test env.
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(async () => { throw new Error('tauri not available'); })
}));

import { NativeDatabaseClient } from '$lib/db/native/client';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import type { AppDatabase } from '$lib/db/client';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { migrations } from '$lib/db/browser/migrations/index';
import { ulid } from '$lib/utils/id';

describe('NativeDatabaseClient', () => {
	it('throws "native client not wired" on every operation', async () => {
		const client = new NativeDatabaseClient();

		await expect(client.accounts.list()).rejects.toThrow();
		await expect(client.accounts.get('x')).rejects.toThrow();
		await expect(client.accounts.getBalance('x')).rejects.toThrow();
		await expect(client.accounts.create({ name: 'a', type: 'checking', currency: 'VND' })).rejects.toThrow();
		await expect(client.accounts.update('x', {})).rejects.toThrow();
		await expect(client.accounts.delete('x')).rejects.toThrow();

		await expect(client.transactions.list()).rejects.toThrow();
		await expect(client.transactions.get('x')).rejects.toThrow();
		await expect(client.transactions.create({ kind: 'expense', date: '2026-01-01', amount: 100, account_id: 'x' })).rejects.toThrow();
		await expect(client.transactions.createBatch([])).rejects.toThrow();
		await expect(client.transactions.update('x', {})).rejects.toThrow();
		await expect(client.transactions.delete('x')).rejects.toThrow();
		await expect(client.transactions.restore('x')).rejects.toThrow();
		await expect(client.transactions.duplicate('x')).rejects.toThrow();

		await expect(client.categories.listBuckets()).rejects.toThrow();
		await expect(client.categories.listTags()).rejects.toThrow();
		await expect(client.categories.createBucket('b')).rejects.toThrow();

		await expect(client.budgets.getForMonth('2026-01')).rejects.toThrow();
		await expect(client.budgets.hasAllocations('2026-01')).rejects.toThrow();

		await expect(client.goals.list()).rejects.toThrow();
		await expect(client.goals.get('x')).rejects.toThrow();

		await expect(client.rules.list()).rejects.toThrow();
		await expect(client.rules.listAll()).rejects.toThrow();

		await expect(client.meta.get('k')).rejects.toThrow();
		await expect(client.meta.set('k', 'v')).rejects.toThrow();
		await expect(client.meta.isFirstRunComplete()).rejects.toThrow();

		await expect(client.debts.list()).rejects.toThrow();

		await expect(client.reconciliations.getHistory('x')).rejects.toThrow();

		await expect(client.reports.getOverview('2026-01')).rejects.toThrow();
	});

	it('generates unique operation IDs', () => {
		const id1 = ulid();
		const id2 = ulid();
		expect(id1).not.toBe(id2);
		expect(id1.length).toBe(26);
		expect(id2.length).toBe(26);
	});
});

describe('AppDatabase domain port', () => {
	it('does not expose execute or transaction', () => {
		const db = createTestDb();
		const client = new BrowserDatabaseClient(db);

		// AppDatabase interface should not have execute or transaction
		expect((client as unknown as Record<string, unknown>)).not.toHaveProperty('execute');
		expect((client as unknown as Record<string, unknown>)).not.toHaveProperty('transaction');

		// Each service group should also not expose execute/transaction
		expect((client.accounts as unknown as Record<string, unknown>)).not.toHaveProperty('execute');
		expect((client.accounts as unknown as Record<string, unknown>)).not.toHaveProperty('transaction');
		expect((client.transactions as unknown as Record<string, unknown>)).not.toHaveProperty('execute');
		expect((client.transactions as unknown as Record<string, unknown>)).not.toHaveProperty('transaction');
	});

	it('implements AppDatabase interface', () => {
		const db = createTestDb();
		const client: AppDatabase = new BrowserDatabaseClient(db);

		expect(client).toHaveProperty('accounts');
		expect(client).toHaveProperty('transactions');
		expect(client).toHaveProperty('categories');
		expect(client).toHaveProperty('budgets');
		expect(client).toHaveProperty('goals');
		expect(client).toHaveProperty('rules');
		expect(client).toHaveProperty('meta');
		expect(client).toHaveProperty('debts');
		expect(client).toHaveProperty('reconciliations');
		expect(client).toHaveProperty('reports');
	});
});

describe('BrowserDatabaseClient', () => {
	let db: ReturnType<typeof createTestDb>;
	let client: BrowserDatabaseClient;

	beforeEach(async () => {
		db = createTestDb();
		await runMigrations(db, migrations);
		client = new BrowserDatabaseClient(db);
	});

	it('preserves DatabaseService interface via raw accessor', () => {
		expect(client.raw).toBe(db);
		expect(typeof client.raw.execute).toBe('function');
		expect(typeof client.raw.query).toBe('function');
		expect(typeof client.raw.transaction).toBe('function');
	});

	it('can create and list accounts through domain port', async () => {
		const id = await client.accounts.create({
			name: 'Test Account',
			type: 'checking',
			currency: 'VND'
		});
		expect(id).toBeTruthy();
		expect(id.length).toBe(26);

		const accounts = await client.accounts.list();
		expect(accounts).toHaveLength(1);
		expect(accounts[0].name).toBe('Test Account');
		expect(accounts[0].balance).toBe(0);
	});

	it('can create and list categories through domain port', async () => {
		const bucketId = await client.categories.createBucket('Food');
		expect(bucketId).toBeTruthy();

		const tagId = await client.categories.createTag('Groceries', bucketId);
		expect(tagId).toBeTruthy();

		const buckets = await client.categories.listBuckets();
		expect(buckets.length).toBeGreaterThanOrEqual(5); // 4 seed + 1 new

		const tags = await client.categories.listTags(bucketId);
		expect(tags).toHaveLength(1);
		expect(tags[0].name).toBe('Groceries');
	});

	it('can set and get meta through domain port', async () => {
		await client.meta.set('locale', 'vi');
		const locale = await client.meta.get('locale');
		expect(locale).toBe('vi');

		await client.meta.delete('locale');
		const deleted = await client.meta.get('locale');
		expect(deleted).toBeNull();
	});

	it('can create and list transactions through domain port', async () => {
		const accountId = await client.accounts.create({
			name: 'Cash',
			type: 'cash',
			currency: 'VND'
		});

		const txId = await client.transactions.create({
			kind: 'expense',
			date: '2026-01-15',
			amount: 50000,
			account_id: accountId,
			payee: 'Coffee Shop'
		});
		expect(txId).toBeTruthy();

		const txns = await client.transactions.list();
		expect(txns).toHaveLength(1);
		expect(txns[0].payee).toBe('Coffee Shop');
		expect(txns[0].amount).toBe(50000);
	});
});

describe('Forwarder paths', () => {
	it('re-exports DatabaseService from old path', async () => {
		const mod = await import('$lib/db/service');
		// DatabaseService is a TypeScript interface (type-only), not a runtime value
		expect(mod).toHaveProperty('createTauriDb');
		expect(mod).toHaveProperty('uniqueSavepointName');
		expect(mod).toHaveProperty('TauriDatabase');
	});

	it('re-exports migrations from old path', async () => {
		const mod = await import('$lib/db/migrations/index');
		expect(mod).toHaveProperty('migrations');
		expect(mod).toHaveProperty('LATEST_SCHEMA_VERSION');
		expect(mod.LATEST_SCHEMA_VERSION).toBe(5);
	});

	it('re-exports runner from old path', async () => {
		const mod = await import('$lib/db/migrations/runner');
		expect(mod).toHaveProperty('runMigrations');
		expect(typeof mod.runMigrations).toBe('function');
	});

	it('re-exports repos from old paths', async () => {
		const accounts = await import('$lib/db/repos/accounts');
		expect(accounts).toHaveProperty('listAccounts');
		expect(accounts).toHaveProperty('createAccount');

		const transactions = await import('$lib/db/repos/transactions');
		expect(transactions).toHaveProperty('listTransactions');
		expect(transactions).toHaveProperty('createTransaction');

		const categories = await import('$lib/db/repos/categories');
		expect(categories).toHaveProperty('listBuckets');
		expect(categories).toHaveProperty('createTag');

		const budgets = await import('$lib/db/repos/budgets');
		expect(budgets).toHaveProperty('getBudgetsForMonth');
		expect(budgets).toHaveProperty('setAllocation');

		const goals = await import('$lib/db/repos/goals');
		expect(goals).toHaveProperty('listGoals');
		expect(goals).toHaveProperty('createGoal');

		const meta = await import('$lib/db/repos/meta');
		expect(meta).toHaveProperty('getMeta');
		expect(meta).toHaveProperty('setMeta');

		const rules = await import('$lib/db/repos/rules');
		expect(rules).toHaveProperty('listRules');
		expect(rules).toHaveProperty('createRule');
	});
});
