import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as debts from '$lib/db/repos/debts';
import * as accounts from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('listDebts', () => {
	it('separates I owe and owed to me', async () => {
		await accounts.createAccount(db, { name: 'Bob owes me', type: 'loan_to_person', currency: 'VND', counterparty: 'Bob', initial_balance: 500000 });
		await accounts.createAccount(db, { name: 'I owe Alice', type: 'loan_from_person', currency: 'VND', counterparty: 'Alice', initial_balance: 300000 });

		const result = await debts.listDebts(db);
		expect(result.owed_to_me).toHaveLength(1);
		expect(result.owed_to_me[0].counterparty).toBe('Bob');
		expect(result.i_owe).toHaveLength(1);
		expect(result.i_owe[0].counterparty).toBe('Alice');
	});

	it('includes balance', async () => {
		await accounts.createAccount(db, { name: 'Loan', type: 'loan_to_person', currency: 'VND', counterparty: 'Bob', initial_balance: 1000000 });
		const result = await debts.listDebts(db);
		expect(result.owed_to_me[0].balance).toBe(1000000);
	});
});

describe('writeOff', () => {
	it('creates expense for loan_to_person (we lose money)', async () => {
		const id = await accounts.createAccount(db, { name: 'Loan', type: 'loan_to_person', currency: 'VND', counterparty: 'Bob', initial_balance: 1000000 });
		await debts.writeOff(db, id, 500000);

		const balance = await accounts.getBalance(db, id);
		expect(balance).toBe(500000); // 1M initial - 500k expense
	});

	it('creates income for loan_from_person (debt forgiven)', async () => {
		const id = await accounts.createAccount(db, { name: 'Debt', type: 'loan_from_person', currency: 'VND', counterparty: 'Alice', initial_balance: 1000000 });
		await debts.writeOff(db, id, 500000, 'tag_gift');

		const balance = await accounts.getBalance(db, id);
		expect(balance).toBe(1500000); // 1M initial + 500k income
	});
});
