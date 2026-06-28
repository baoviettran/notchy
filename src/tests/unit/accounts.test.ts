import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('createAccount', () => {
	it('creates a checking account', async () => {
		const id = await repo.createAccount(db, { name: 'My Bank', type: 'checking', currency: 'VND' });
		const acc = await repo.getAccount(db, id);
		expect(acc).not.toBeNull();
		expect(acc!.name).toBe('My Bank');
		expect(acc!.type).toBe('checking');
	});

	it('creates initial balance adjustment', async () => {
		const id = await repo.createAccount(db, {
			name: 'Wallet', type: 'cash', currency: 'VND',
			initial_balance: 500000, initial_balance_date: '2026-01-01'
		});
		const balance = await repo.getBalance(db, id);
		expect(balance).toBe(500000);
	});

	it('stores liability opening balance as negative (owed)', async () => {
		// Liability accounts (credit_card, loan_from_person) carry balances as
		// negative magnitudes: an opening credit-card debt of 4,000,000 must
		// produce a balance of -4,000,000, not +4,000,000. The dashboard renders
		// liabilities via Math.abs(); net_worth sums the signed value.
		const id = await repo.createAccount(db, {
			name: 'Credit Card', type: 'credit_card', currency: 'VND',
			initial_balance: 4000000, initial_balance_date: '2026-01-01'
		});
		const balance = await repo.getBalance(db, id);
		expect(balance).toBe(-4000000);
	});

	it('requires counterparty for loan_to_person', async () => {
		await expect(
			repo.createAccount(db, { name: 'Loan', type: 'loan_to_person', currency: 'VND' })
		).rejects.toThrow('Counterparty is required');
	});

	it('allows loan with counterparty', async () => {
		const id = await repo.createAccount(db, {
			name: 'Loan to Bob', type: 'loan_to_person', currency: 'VND', counterparty: 'Bob'
		});
		const acc = await repo.getAccount(db, id);
		expect(acc!.counterparty).toBe('Bob');
	});

	it('enforces single-currency rule', async () => {
		await repo.createAccount(db, { name: 'VND Account', type: 'checking', currency: 'VND' });
		await expect(
			repo.createAccount(db, { name: 'USD Account', type: 'checking', currency: 'USD' })
		).rejects.toThrow('same currency');
	});
});

describe('getBalance', () => {
	it('computes balance from income and expense', async () => {
		const id = await repo.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND' });
		const now = new Date().toISOString();
		const today = now.split('T')[0];

		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['t1', 'income', today, 1000000, id, now, now]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['t2', 'expense', today, 300000, id, now, now]
		);

		const balance = await repo.getBalance(db, id);
		expect(balance).toBe(700000);
	});

	it('excludes future-dated transactions', async () => {
		const id = await repo.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND' });
		const now = new Date().toISOString();

		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			['t1', 'income', '2099-12-31', 1000000, id, now, now]
		);

		const balance = await repo.getBalance(db, id);
		expect(balance).toBe(0);
	});

	it('excludes soft-deleted transactions', async () => {
		const id = await repo.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND' });
		const now = new Date().toISOString();
		const today = now.split('T')[0];

		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			['t1', 'income', today, 1000000, id, now, now, now]
		);

		const balance = await repo.getBalance(db, id);
		expect(balance).toBe(0);
	});

	it('handles transfers correctly (subtracts from source, adds to dest)', async () => {
		const sourceId = await repo.createAccount(db, { name: 'Source', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		const destId = await repo.createAccount(db, { name: 'Dest', type: 'savings', currency: 'VND' });
		const now = new Date().toISOString();
		const today = now.split('T')[0];

		// Create a transfer (single-row model)
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, created_at, updated_at)
			 VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?, ?)`,
			['t1', today, 300000, sourceId, destId, 'pair1', now, now]
		);

		expect(await repo.getBalance(db, sourceId)).toBe(700000); // 1M - 300k
		expect(await repo.getBalance(db, destId)).toBe(300000); // 0 + 300k
	});
});

describe('updateAccount', () => {
	it('renames an account', async () => {
		const id = await repo.createAccount(db, { name: 'Old', type: 'checking', currency: 'VND' });
		await repo.updateAccount(db, id, { name: 'New' });
		const acc = await repo.getAccount(db, id);
		expect(acc!.name).toBe('New');
	});

	it('allows asset-to-asset type change', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await repo.updateAccount(db, id, { type: 'savings' });
		const acc = await repo.getAccount(db, id);
		expect(acc!.type).toBe('savings');
	});

	it('forbids asset-to-liability type change', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await expect(
			repo.updateAccount(db, id, { type: 'credit_card' })
		).rejects.toThrow('Cannot change between asset and liability');
	});

	it('forbids changing to/from loan types', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await expect(
			repo.updateAccount(db, id, { type: 'loan_to_person' })
		).rejects.toThrow('Cannot change to or from loan');
	});

	it('archives an account', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await repo.updateAccount(db, id, { archived: 1 });
		const acc = await repo.getAccount(db, id);
		expect(acc!.archived).toBe(1);
	});
});

describe('deleteAccount', () => {
	it('soft-deletes an account', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await repo.deleteAccount(db, id);
		const acc = await repo.getAccount(db, id);
		expect(acc).toBeNull();
	});

	it('soft-deleted account not in list', async () => {
		const id = await repo.createAccount(db, { name: 'Acc', type: 'checking', currency: 'VND' });
		await repo.deleteAccount(db, id);
		const list = await repo.listAccounts(db);
		expect(list.find((a) => a.id === id)).toBeUndefined();
	});

	it('blocks delete when active goal links to account', async () => {
		const accId = await repo.createAccount(db, { name: 'Savings', type: 'savings', currency: 'VND' });
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO goals (id, name, type, target_amount, target_date, linked_account_id, starting_amount, created_at, updated_at)
			 VALUES ('g1', 'Vacation', 'savings', 10000000, '2027-01-01', ?, 0, ?, ?)`,
			[accId, now, now]
		);

		await expect(repo.deleteAccount(db, accId)).rejects.toThrow('linked to 1 active goal');
	});

	it('allows delete when goal is completed', async () => {
		const accId = await repo.createAccount(db, { name: 'Savings', type: 'savings', currency: 'VND' });
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO goals (id, name, type, target_amount, target_date, linked_account_id, starting_amount, status, created_at, updated_at)
			 VALUES ('g1', 'Vacation', 'savings', 10000000, '2027-01-01', ?, 0, 'completed', ?, ?)`,
			[accId, now, now]
		);

		await expect(repo.deleteAccount(db, accId)).resolves.toBeUndefined();
	});
});

describe('listAccounts', () => {
	it('returns accounts with balances', async () => {
		await repo.createAccount(db, { name: 'A', type: 'checking', currency: 'VND', initial_balance: 100000 });
		await repo.createAccount(db, { name: 'B', type: 'credit_card', currency: 'VND' });
		const list = await repo.listAccounts(db);
		expect(list).toHaveLength(2);
		expect(list[0].balance).toBe(100000);
	});
});
