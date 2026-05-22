import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as recon from '$lib/db/repos/reconciliations';
import * as accounts from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('reconcile', () => {
	it('records reconciliation without adjustment when no discrepancy', async () => {
		const accId = await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		const result = await recon.reconcile(db, accId, 1000000, true);
		expect(result.discrepancy).toBe(0);
		expect(result.adjustment_transaction_id).toBeNull();
	});

	it('creates adjustment for positive discrepancy', async () => {
		const accId = await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		const result = await recon.reconcile(db, accId, 1200000, true);
		expect(result.discrepancy).toBe(200000);
		expect(result.adjustment_transaction_id).not.toBeNull();

		// Balance should now match actual
		const balance = await accounts.getBalance(db, accId);
		expect(balance).toBe(1200000);
	});

	it('creates expense for negative discrepancy', async () => {
		const accId = await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		const result = await recon.reconcile(db, accId, 800000, true);
		expect(result.discrepancy).toBe(-200000);

		const balance = await accounts.getBalance(db, accId);
		expect(balance).toBe(800000);
	});

	it('records without adjustment when createAdjustment is false', async () => {
		const accId = await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		const result = await recon.reconcile(db, accId, 500000, false);
		expect(result.discrepancy).toBe(-500000);
		expect(result.adjustment_transaction_id).toBeNull();

		// Balance unchanged
		const balance = await accounts.getBalance(db, accId);
		expect(balance).toBe(1000000);
	});
});

describe('getReconciliationHistory', () => {
	it('returns history for an account', async () => {
		const accId = await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND', initial_balance: 1000000 });
		await recon.reconcile(db, accId, 1000000, false, 'First check');
		await recon.reconcile(db, accId, 1000000, false, 'Second check');

		const history = await recon.getReconciliationHistory(db, accId);
		expect(history).toHaveLength(2);
	});
});

describe('isLargeDiscrepancy', () => {
	it('flags discrepancies over 1M', () => {
		expect(recon.isLargeDiscrepancy(1000001)).toBe(true);
		expect(recon.isLargeDiscrepancy(-1000001)).toBe(true);
		expect(recon.isLargeDiscrepancy(999999)).toBe(false);
	});
});
