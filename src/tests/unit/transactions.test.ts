import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;
const NOW = new Date().toISOString();
const TODAY = NOW.split('T')[0];

async function seedAccount(id = 'acc1', name = 'Test') {
	await db.execute(
		`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES (?, ?, 'checking', 'VND', ?, ?)`,
		[id, name, NOW, NOW]
	);
}

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	await seedAccount();
	await seedAccount('acc2', 'Second');
});

describe('createTransaction', () => {
	it('creates an expense', async () => {
		const id = await repo.createTransaction(db, {
			kind: 'expense', date: TODAY, amount: 50000, account_id: 'acc1', tag_id: 'tag_initial_balance', payee: 'Coffee'
		});
		const tx = await repo.getTransaction(db, id);
		expect(tx!.kind).toBe('expense');
		expect(tx!.amount).toBe(50000);
		expect(tx!.payee).toBe('Coffee');
	});

	it('creates a single-row transfer with pair id', async () => {
		const id = await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});
		const tx = await repo.getTransaction(db, id);
		expect(tx!.transfer_pair_id).not.toBeNull();
		expect(tx!.account_id).toBe('acc1');
		expect(tx!.transfer_account_id).toBe('acc2');

		const all = await db.query<{ id: string }>(
			`SELECT id FROM transactions WHERE transfer_pair_id = ? AND deleted_at IS NULL`,
			[tx!.transfer_pair_id]
		);
		expect(all).toHaveLength(1);
	});

	it('rejects transfer without destination', async () => {
		await expect(
			repo.createTransaction(db, { kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1' })
		).rejects.toThrow('destination account');
	});
});

describe('listTransactions', () => {
	it('filters by account', async () => {
		await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 1000, account_id: 'acc1' });
		await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 2000, account_id: 'acc2' });

		const list = await repo.listTransactions(db, { account_id: 'acc1' });
		expect(list).toHaveLength(1);
		expect(list[0].amount).toBe(1000);
	});

	it('includes incoming transfers when filtering by destination account', async () => {
		// Single-row transfer model: account_id = source, transfer_account_id = dest.
		// Filtering by an account must match BOTH columns or the destination
		// account's ledger silently drops incoming transfers.
		await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});

		const dest = await repo.listTransactions(db, { account_id: 'acc2' });
		expect(dest).toHaveLength(1);
		expect(dest[0].kind).toBe('transfer');
		expect(dest[0].id).toBe(
			(await repo.listTransactions(db, { account_id: 'acc1' }))[0].id
		);
	});

	it('filters by date range', async () => {
		await repo.createTransaction(db, { kind: 'expense', date: '2026-01-01', amount: 1000, account_id: 'acc1' });
		await repo.createTransaction(db, { kind: 'expense', date: '2026-06-01', amount: 2000, account_id: 'acc1' });

		const list = await repo.listTransactions(db, { date_from: '2026-05-01', date_to: '2026-12-31' });
		expect(list).toHaveLength(1);
		expect(list[0].amount).toBe(2000);
	});

	it('searches by payee', async () => {
		await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 1000, account_id: 'acc1', payee: 'Highlands Coffee' });
		await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 2000, account_id: 'acc1', payee: 'Grab' });

		const list = await repo.listTransactions(db, { query: 'Highland' });
		expect(list).toHaveLength(1);
	});

	it('excludes soft-deleted', async () => {
		const id = await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 1000, account_id: 'acc1' });
		await repo.deleteTransaction(db, id);
		const list = await repo.listTransactions(db);
		expect(list.find((t) => t.id === id)).toBeUndefined();
	});
});

describe('updateTransaction', () => {
	it('updates amount and payee', async () => {
		const id = await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 1000, account_id: 'acc1' });
		await repo.updateTransaction(db, id, { amount: 2000, payee: 'Updated' });
		const tx = await repo.getTransaction(db, id);
		expect(tx!.amount).toBe(2000);
		expect(tx!.payee).toBe('Updated');
	});

	it('updates a transfer amount', async () => {
		const id = await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});
		await repo.updateTransaction(db, id, { amount: 200000 });

		const tx = await repo.getTransaction(db, id);
		expect(tx!.amount).toBe(200000);
	});

	it('updates a transfer destination account', async () => {
		// Repointing a transfer's destination must change transfer_account_id.
		// Bug today: applyPatch ignores transfer_account_id, so the edit is
		// silently dropped while the UI shows the new destination.
		await seedAccount('acc3', 'Third');
		const id = await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});
		await repo.updateTransaction(db, id, { transfer_account_id: 'acc3' });

		const tx = await repo.getTransaction(db, id);
		expect(tx!.transfer_account_id).toBe('acc3');
	});

	it('rejects updating a transfer to point at its own source (self-transfer)', async () => {
		await seedAccount('acc3', 'Third');
		const id = await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});
		await expect(repo.updateTransaction(db, id, { transfer_account_id: 'acc1' })).rejects.toThrow(
			'Transfer destination must differ from source'
		);
	});
});

describe('deleteTransaction', () => {
	it('soft-deletes a transaction', async () => {
		const id = await repo.createTransaction(db, { kind: 'expense', date: TODAY, amount: 1000, account_id: 'acc1' });
		await repo.deleteTransaction(db, id);
		expect(await repo.getTransaction(db, id)).toBeNull();
	});

	it('deletes a transfer', async () => {
		const id = await repo.createTransaction(db, {
			kind: 'transfer', date: TODAY, amount: 100000, account_id: 'acc1', transfer_account_id: 'acc2'
		});
		await repo.deleteTransaction(db, id);

		const remaining = await db.query<{ id: string }>(
			`SELECT id FROM transactions WHERE id = ? AND deleted_at IS NULL`,
			[id]
		);
		expect(remaining).toHaveLength(0);
	});
});

describe('duplicateTransaction', () => {
	it('creates a copy with today date', async () => {
		const id = await repo.createTransaction(db, {
			kind: 'expense', date: '2026-01-01', amount: 50000, account_id: 'acc1', payee: 'Coffee'
		});
		const newId = await repo.duplicateTransaction(db, id);
		const tx = await repo.getTransaction(db, newId);
		expect(tx!.amount).toBe(50000);
		expect(tx!.payee).toBe('Coffee');
		expect(tx!.date).toBe(new Date().toISOString().split('T')[0]);
	});
});
