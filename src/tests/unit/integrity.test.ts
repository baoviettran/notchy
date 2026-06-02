import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { runIntegrityCheck, checkOrphanedTransfers, IntegrityError } from '$lib/db/integrity';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('IntegrityError', () => {
	it('has name property set to IntegrityError', () => {
		const err = new IntegrityError('test');
		expect(err.name).toBe('IntegrityError');
	});

	it('is an instance of Error', () => {
		const err = new IntegrityError('test');
		expect(err).toBeInstanceOf(Error);
	});
});

describe('runIntegrityCheck', () => {
	it('passes on a fresh DB', async () => {
		await expect(runIntegrityCheck(db)).resolves.toBeUndefined();
	});
});

describe('checkOrphanedTransfers', () => {
	it('does not throw on a fresh DB with no transfers', async () => {
		await expect(checkOrphanedTransfers(db)).resolves.toBeUndefined();
	});

	it('clears stale warnings when no orphans exist', async () => {
		// Insert a stale warning first
		await db.execute(`INSERT INTO app_meta (key, value) VALUES ('integrity_warnings', '[]')`);
		await checkOrphanedTransfers(db);

		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'integrity_warnings'`
		);
		expect(rows).toHaveLength(0);
	});

	it('inserts warning when duplicate transfer_pair_id exists', async () => {
		// Insert two transfer transactions with the same pair_id (orphan condition)
		const pairId = 'test-pair-orphan';
		// Create two accounts (transfers need transfer_account_id)
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('acc1', 'Test', 'checking', 'VND', '2026-01-01', '2026-01-01')`
		);
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('acc2', 'Test2', 'savings', 'VND', '2026-01-01', '2026-01-01')`
		);

		await db.execute(
			`INSERT INTO transactions (id, account_id, kind, amount, date, transfer_account_id, transfer_pair_id, created_at, updated_at) VALUES ('t1', 'acc1', 'transfer', 1000, '2026-01-01', 'acc2', ?, '2026-01-01', '2026-01-01')`,
			[pairId]
		);
		await db.execute(
			`INSERT INTO transactions (id, account_id, kind, amount, date, transfer_account_id, transfer_pair_id, created_at, updated_at) VALUES ('t2', 'acc2', 'transfer', 1000, '2026-01-01', 'acc1', ?, '2026-01-01', '2026-01-01')`,
			[pairId]
		);

		await checkOrphanedTransfers(db);

		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'integrity_warnings'`
		);
		expect(rows).toHaveLength(1);
		const warnings = JSON.parse(rows[0].value);
		expect(warnings).toHaveLength(1);
		expect(warnings[0].pair).toBe(pairId);
	});
});
