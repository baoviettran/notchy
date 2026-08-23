import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as accounts from '$lib/db/repos/accounts';
import * as categories from '$lib/db/repos/categories';
import * as transactions from '$lib/db/repos/transactions';
import type { DatabaseService } from '$lib/db';

let db: DatabaseService;
let checkingId: string;
let savingsId: string;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	checkingId = await accounts.createAccount(db, { name: 'Checking', type: 'checking', currency: 'VND', initial_balance: 1000000 });
	savingsId = await accounts.createAccount(db, { name: 'Savings', type: 'savings', currency: 'VND', initial_balance: 0 });
});

describe('updateTransaction kind change (edit-mode repair path)', () => {
	it('reclassifies expense to income, keeping fields intact', async () => {
		const id = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-01', amount: 50000, account_id: checkingId, payee: 'Cafe' });
		await transactions.updateTransaction(db, id, { kind: 'income' });

		const row = await transactions.getTransaction(db, id);
		expect(row?.kind).toBe('income');
		expect(row?.payee).toBe('Cafe');
		expect(row?.transfer_account_id).toBeNull();
	});

	it('converts expense to transfer when a destination is provided', async () => {
		const id = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-01', amount: 50000, account_id: checkingId, payee: 'Move' });
		await transactions.updateTransaction(db, id, { kind: 'transfer', transfer_account_id: savingsId });

		const row = await transactions.getTransaction(db, id);
		expect(row?.kind).toBe('transfer');
		expect(row?.transfer_account_id).toBe(savingsId);
		expect(row?.transfer_pair_id).not.toBeNull();
	});

	it('rejects converting to a self-transfer', async () => {
		const id = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-01', amount: 50000, account_id: checkingId });
		await expect(
			transactions.updateTransaction(db, id, { kind: 'transfer', transfer_account_id: checkingId })
		).rejects.toThrow();
	});

	it('rejects converting to a transfer without a destination', async () => {
		const id = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-01', amount: 50000, account_id: checkingId });
		await expect(transactions.updateTransaction(db, id, { kind: 'transfer' })).rejects.toThrow();
	});

	it('converts a transfer back to an expense and clears transfer columns', async () => {
		const id = await transactions.createTransaction(db, { kind: 'transfer', date: '2026-08-01', amount: 50000, account_id: checkingId, transfer_account_id: savingsId });
		await transactions.updateTransaction(db, id, { kind: 'expense' });

		const row = await transactions.getTransaction(db, id);
		expect(row?.kind).toBe('expense');
		expect(row?.transfer_account_id).toBeNull();
		expect(row?.transfer_pair_id).toBeNull();
	});

	it('repoints a transfer destination on an existing transfer', async () => {
		const thirdId = await accounts.createAccount(db, { name: 'Third', type: 'savings', currency: 'VND', initial_balance: 0 });
		const id = await transactions.createTransaction(db, { kind: 'transfer', date: '2026-08-01', amount: 50000, account_id: checkingId, transfer_account_id: savingsId });
		await transactions.updateTransaction(db, id, { transfer_account_id: thirdId });
		expect((await transactions.getTransaction(db, id))?.transfer_account_id).toBe(thirdId);

		// Repointing to the source account must be rejected.
		await expect(
			transactions.updateTransaction(db, id, { transfer_account_id: checkingId })
		).rejects.toThrow();
	});
});

describe('bulk transaction operations', () => {
	let a: string;
	let b: string;
	let c: string;

	beforeEach(async () => {
		a = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-01', amount: 1000, account_id: checkingId, payee: 'A' });
		b = await transactions.createTransaction(db, { kind: 'expense', date: '2026-08-02', amount: 2000, account_id: checkingId, payee: 'B' });
		c = await transactions.createTransaction(db, { kind: 'income', date: '2026-08-03', amount: 3000, account_id: checkingId, payee: 'C' });
	});

	it('deleteMany soft-deletes only the selected rows', async () => {
		await transactions.deleteTransactions(db, [a, c]);

		expect(await transactions.getTransaction(db, a)).toBeNull();
		expect(await transactions.getTransaction(db, b)).not.toBeNull();
		expect(await transactions.getTransaction(db, c)).toBeNull();

		// Soft-deleted rows are restorable for undo.
		await transactions.restoreTransaction(db, a);
		expect(await transactions.getTransaction(db, a)).not.toBeNull();
	});

	it('setTagMany retags only the selected rows, clearing with null', async () => {
		const bucketId = await categories.createBucket(db, 'Essentials');
		const tagId = await categories.createTag(db, 'Food', bucketId);
		await transactions.setTagMany(db, [a, b], tagId);

		expect((await transactions.getTransaction(db, a))?.tag_id).toBe(tagId);
		expect((await transactions.getTransaction(db, b))?.tag_id).toBe(tagId);
		expect((await transactions.getTransaction(db, c))?.tag_id).toBeNull();

		await transactions.setTagMany(db, [a], null);
		expect((await transactions.getTransaction(db, a))?.tag_id).toBeNull();
	});

	it('setAccountMany repoints the account of the selected rows', async () => {
		await transactions.setAccountMany(db, [b, c], savingsId);

		expect((await transactions.getTransaction(db, b))?.account_id).toBe(savingsId);
		expect((await transactions.getTransaction(db, c))?.account_id).toBe(savingsId);
		expect((await transactions.getTransaction(db, a))?.account_id).toBe(checkingId);
	});
});
