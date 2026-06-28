import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('transaction() error handling', () => {
	it('releases the savepoint after a failed transaction (no stack leak)', async () => {
		// A top-level transaction that throws. After it errors, its SAVEPOINT
		// must be fully removed from SQLite's stack — not just rewound.
		// ROLLBACK TO leaves the savepoint in place; only RELEASE removes it.
		// If it leaks, a subsequent bare ROLLBACK finds a savepoint on the stack
		// and rolls it back, undoing writes that should be independent.
		await db.execute(`INSERT INTO app_meta (key, value) VALUES ('k1', 'before')`);

		await expect(db.transaction(async (tx) => {
			await tx.execute(`INSERT INTO app_meta (key, value) VALUES ('k2', 'inside')`);
			throw new Error('boom');
		})).rejects.toThrow('boom');

		// k2 was rolled back. k1 survives.
		const after = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'k1'`);
		expect(after[0]?.value).toBe('before');
		const k2 = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'k2'`);
		expect(k2).toHaveLength(0);

		// Now make an INDEPENDENT write outside any transaction, then issue a
		// bare ROLLBACK. With the savepoint properly released, no transaction is
		// active and ROLLBACK throws "cannot rollback - no transaction is active"
		// (which we tolerate) and k3 survives. If the savepoint leaked, ROLLBACK
		// targets it silently and erases k3 — the bug.
		await db.execute(`INSERT INTO app_meta (key, value) VALUES ('k3', 'independent')`);
		await db.execute(`ROLLBACK`).catch(() => { /* no txn active — expected when fixed */ });

		const k3 = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'k3'`);
		// If the savepoint leaked, k3 is gone. If properly released, k3 survives.
		expect(k3[0]?.value).toBe('independent');
	});

	it('a failed nested transaction does not affect the outer transaction', async () => {
		await db.transaction(async (outer) => {
			await outer.execute(`INSERT INTO app_meta (key, value) VALUES ('outer', '1')`);

			// Inner transaction fails — must be fully contained.
			await expect(outer.transaction(async (inner) => {
				await inner.execute(`INSERT INTO app_meta (key, value) VALUES ('inner', '1')`);
				throw new Error('inner boom');
			})).rejects.toThrow('inner boom');

			// Outer is unaffected: its prior write survives, inner's is gone.
			const innerRow = await outer.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'inner'`);
			expect(innerRow).toHaveLength(0);
			const outerRow = await outer.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'outer'`);
			expect(outerRow[0]?.value).toBe('1');

			// Outer can still commit more writes after the inner failure.
			await outer.execute(`INSERT INTO app_meta (key, value) VALUES ('outer2', '2')`);
		});

		// Outer committed; both outer writes present.
		const outer2 = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'outer2'`);
		expect(outer2[0]?.value).toBe('2');
	});
});
