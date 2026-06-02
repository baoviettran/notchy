import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { runIntegrityCheck, checkOrphanedTransfers, IntegrityError } from '$lib/db/integrity';
import { applyPragmas } from '$lib/db/pragmas';
import type { DatabaseService } from '$lib/db/service';
import type { Migration } from '$lib/db/migrations/runner';

let db: DatabaseService;

beforeEach(() => {
	db = createTestDb();
});

describe('applyPragmas', () => {
	it('enables foreign keys', async () => {
		await applyPragmas(db);
		const rows = await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
		expect(rows[0].foreign_keys).toBe(1);
	});
});

describe('runMigrations', () => {
	it('creates app_meta and runs migrations in order', async () => {
		const migrations: Migration[] = [
			{ version: 1, name: 'create_foo', up: async (tx) => { await tx.execute('CREATE TABLE foo (id INTEGER)'); } },
			{ version: 2, name: 'create_bar', up: async (tx) => { await tx.execute('CREATE TABLE bar (id INTEGER)'); } }
		];

		await runMigrations(db, migrations);

		const version = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
		expect(version[0].value).toBe('2');

		const tables = await db.query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('foo','bar')`);
		expect(tables).toHaveLength(2);
	});

	it('skips already-applied migrations', async () => {
		const m1: Migration = { version: 1, name: 'first', up: async (tx) => { await tx.execute('CREATE TABLE t1 (id INTEGER)'); } };
		await runMigrations(db, [m1]);

		let callCount = 0;
		const m1Again: Migration = { version: 1, name: 'first', up: async () => { callCount++; } };
		const m2: Migration = { version: 2, name: 'second', up: async (tx) => { await tx.execute('CREATE TABLE t2 (id INTEGER)'); } };
		await runMigrations(db, [m1Again, m2]);

		expect(callCount).toBe(0);
		const version = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
		expect(version[0].value).toBe('2');
	});

	it('rolls back a failed migration without advancing version', async () => {
		const m1: Migration = { version: 1, name: 'ok', up: async (tx) => { await tx.execute('CREATE TABLE ok_table (id INTEGER)'); } };
		const m2: Migration = { version: 2, name: 'fail', up: async () => { throw new Error('boom'); } };

		await runMigrations(db, [m1]);
		await expect(runMigrations(db, [m1, m2])).rejects.toThrow('boom');

		const version = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
		expect(version[0].value).toBe('1');
	});
});

describe('runIntegrityCheck', () => {
	it('passes on a healthy database', async () => {
		await expect(runIntegrityCheck(db)).resolves.toBeUndefined();
	});
});

describe('checkOrphanedTransfers', () => {
	it('stores warnings when duplicate pair_ids exist (orphan in single-row model)', async () => {
		await db.execute(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
		await db.execute(`CREATE TABLE transactions (
			id TEXT PRIMARY KEY, kind TEXT, transfer_pair_id TEXT, deleted_at TEXT
		)`);
		// Two rows with the same pair_id is an orphan in the single-row model
		await db.execute(`INSERT INTO transactions VALUES ('t1', 'transfer', 'pair1', NULL)`);
		await db.execute(`INSERT INTO transactions VALUES ('t2', 'transfer', 'pair1', NULL)`);

		await checkOrphanedTransfers(db);

		const warnings = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'integrity_warnings'`);
		const parsed = JSON.parse(warnings[0].value);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].pair).toBe('pair1');
	});

	it('does not warn when each pair has exactly one row', async () => {
		await db.execute(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
		await db.execute(`CREATE TABLE transactions (
			id TEXT PRIMARY KEY, kind TEXT, transfer_pair_id TEXT, deleted_at TEXT
		)`);
		await db.execute(`INSERT INTO transactions VALUES ('t1', 'transfer', 'pair1', NULL)`);

		await checkOrphanedTransfers(db);

		const warnings = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'integrity_warnings'`);
		expect(warnings).toHaveLength(0);
	});
});
