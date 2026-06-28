import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as accounts from '$lib/db/repos/accounts';
import * as reconciliations from '$lib/db/repos/reconciliations';
import type { DatabaseService, QueryResult, Row } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('reconcile', () => {
	it('creates a positive adjustment when actual > expected', async () => {
		const id = await accounts.createAccount(db, {
			name: 'Cash', type: 'cash', currency: 'VND', initial_balance: 100000
		});
		// Actual is 50,000 higher than the 100,000 on the books.
		const result = await reconciliations.reconcile(db, id, 150000, true);
		expect(result.discrepancy).toBe(50000);
		expect(result.adjustment_transaction_id).not.toBeNull();
		const balance = await accounts.getBalance(db, id);
		expect(balance).toBe(150000);
	});

	it('creates an expense when actual < expected', async () => {
		const id = await accounts.createAccount(db, {
			name: 'Cash', type: 'cash', currency: 'VND', initial_balance: 100000
		});
		// Actual is 30,000 lower than the 100,000 on the books.
		const result = await reconciliations.reconcile(db, id, 70000, true);
		expect(result.discrepancy).toBe(-30000);
		const balance = await accounts.getBalance(db, id);
		expect(balance).toBe(70000);
	});

	it('records a reconciliation row', async () => {
		const id = await accounts.createAccount(db, {
			name: 'Cash', type: 'cash', currency: 'VND', initial_balance: 100000
		});
		await reconciliations.reconcile(db, id, 120000, true, 'note');
		const history = await reconciliations.getReconciliationHistory(db, id);
		expect(history).toHaveLength(1);
		expect(history[0].expected_balance).toBe(100000);
		expect(history[0].actual_balance).toBe(120000);
		expect(history[0].notes).toBe('note');
	});

	it('is atomic: a failure recording the reconciliation rolls back the adjustment', async () => {
		// The adjustment INSERT and the reconciliation INSERT must be one logical
		// operation. If the reconciliation INSERT fails, the adjustment must not
		// be orphaned (which would silently skew the balance with no audit row).
		const id = await accounts.createAccount(db, {
			name: 'Cash', type: 'cash', currency: 'VND', initial_balance: 100000
		});

		// Proxy that fails specifically on the reconciliations INSERT, proving
		// the earlier adjustment write is undone when the whole reconcile fails.
		// `transaction` must pass the proxy itself as `tx` so the failure point
		// is reached inside the transaction body (delegating to the real db's
		// transaction would bypass the proxy entirely).
		const failingDb: DatabaseService = {
			async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
				if (sql.includes('INSERT INTO reconciliations')) {
					throw new Error('simulated reconciliation insert failure');
				}
				return db.execute(sql, params);
			},
			async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
				return db.query<T>(sql, params);
			},
			async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
				return db.transaction(() => fn(failingDb));
			},
			async close(): Promise<void> { return db.close(); }
		};

		await expect(reconciliations.reconcile(failingDb, id, 150000, true)).rejects.toThrow(
			'simulated reconciliation insert failure'
		);

		// The +50,000 adjustment must have been rolled back — balance is the
		// original 100,000, not 150,000. Bug today: it's orphaned at 150,000.
		const balance = await accounts.getBalance(db, id);
		expect(balance).toBe(100000);

		// And no reconciliation row was committed.
		const history = await reconciliations.getReconciliationHistory(db, id);
		expect(history).toHaveLength(0);
	});
});
