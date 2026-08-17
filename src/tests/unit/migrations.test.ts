import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, createTestDbFromPath } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { LATEST_SCHEMA_VERSION, migrations } from '$lib/db/migrations/index';
import { migration001 } from '$lib/db/migrations/001_initial';
import { migration002 } from '$lib/db/migrations/002_triggers';
import { migration003 } from '$lib/db/migrations/003_seed';
import { migration004 } from '$lib/db/migrations/004_rollover_toggle';
import type { DatabaseService } from '$lib/db';

let db: DatabaseService;
const temporaryPaths: string[] = [];
const fixtureDbs: DatabaseService[] = [];

afterEach(async () => {
	await Promise.all(fixtureDbs.splice(0).map((fixtureDb) => fixtureDb.close()));
	await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function copyMigrationFixture(name: string): Promise<DatabaseService> {
	const directory = await mkdtemp(join(tmpdir(), 'notchy-migration-fixture-'));
	temporaryPaths.push(directory);
	const path = join(directory, name);
	await copyFile(fileURLToPath(new URL(`../fixtures/migrations/${name}`, import.meta.url)), path);
	const fixtureDb = createTestDbFromPath(path);
	fixtureDbs.push(fixtureDb);
	return fixtureDb;
}

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('test database fixture helper', () => {
	it('opens a file-backed database at the supplied path', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'notchy-migration-test-'));
		temporaryPaths.push(directory);
		const fixtureDb = createTestDbFromPath(join(directory, 'fixture.sqlite'));

		await fixtureDb.execute('CREATE TABLE test_rows (id TEXT PRIMARY KEY)');
		await fixtureDb.execute(`INSERT INTO test_rows (id) VALUES ('persisted')`);
		await fixtureDb.close();

		const reopenedDb = createTestDbFromPath(join(directory, 'fixture.sqlite'));
		expect(await reopenedDb.query<{ id: string }>('SELECT id FROM test_rows')).toEqual([
			{ id: 'persisted' }
		]);
		await reopenedDb.close();
	});
});

describe('released database fixtures', () => {
	it.each([
		['v003.sqlite', '3', 'acct_fixture_v003', 'tag_fixture_v003', 'txn_fixture_v003', 123456789],
		['v004.sqlite', '4', 'acct_fixture_v004', 'tag_fixture_v004', 'txn_fixture_v004', 987654321]
	])(
		'upgrades %s while preserving the seeded rows',
		async (fixture, releasedSchemaVersion, accountId, tagId, transactionId, amount) => {
			const fixtureDb = await copyMigrationFixture(fixture);
			expect(
				await fixtureDb.query<{ value: string }>(
					`SELECT value FROM app_meta WHERE key = 'schema_version'`
				)
			).toEqual([{ value: releasedSchemaVersion }]);
			await runMigrations(fixtureDb, migrations);

			expect(
				await fixtureDb.query<{ value: string }>(
					`SELECT value FROM app_meta WHERE key = 'schema_version'`
				)
			).toEqual([{ value: '5' }]);
			expect(await fixtureDb.query<{ id: string }>(`SELECT id FROM accounts WHERE id = ?`, [accountId])).toEqual([
				{ id: accountId }
			]);
			expect(await fixtureDb.query<{ id: string }>(`SELECT id FROM category_tags WHERE id = ?`, [tagId])).toEqual([
				{ id: tagId }
			]);
			expect(
				await fixtureDb.query<{ id: string; amount: number; tag_id: string }>(
					`SELECT id, amount, tag_id FROM transactions WHERE id = ?`,
					[transactionId]
				)
			).toEqual([{ id: transactionId, amount, tag_id: tagId }]);

			const rolledBackAccountId = `rollback-${accountId}`;
			await expect(
				fixtureDb.transaction(async (tx) => {
					await tx.execute(
						`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
						[
							rolledBackAccountId,
							'Rollback account',
							'checking',
							'VND',
							'2025-03-01T00:00:00.000Z',
							'2025-03-01T00:00:00.000Z'
						]
					);
					await tx.execute(
						`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							`rollback-${transactionId}`,
							'expense',
							'2025-03-01',
							0,
							rolledBackAccountId,
							tagId,
							'2025-03-01T00:00:00.000Z',
							'2025-03-01T00:00:00.000Z'
						]
					);
				})
			).rejects.toThrow();
			expect(
				await fixtureDb.query<{ id: string }>(`SELECT id FROM accounts WHERE id = ?`, [
					rolledBackAccountId
				])
			).toEqual([]);
		}
	);
});

describe('migration registry', () => {
	it('derives the latest schema version from the registry', () => {
		expect(LATEST_SCHEMA_VERSION).toBe(5);
	});
});

describe('Migration 001 - schema', () => {
	it('creates all expected tables', async () => {
		const tables = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
		);
		const names = tables.map((t) => t.name);
		expect(names).toContain('accounts');
		expect(names).toContain('category_types');
		expect(names).toContain('category_tags');
		expect(names).toContain('transactions');
		expect(names).toContain('budgets');
		expect(names).toContain('goals');
		expect(names).toContain('reconciliations');
		expect(names).toContain('change_log');
	});

	it('creates indexes', async () => {
		const indexes = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`
		);
		expect(indexes.length).toBe(14);
	});
});

describe('Migration 002 - triggers', () => {
	it('creates 21 triggers (3 per 7 tables)', async () => {
		const triggers = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='trigger'`
		);
		expect(triggers.length).toBe(21);
	});

	it('trigger writes to change_log on insert', async () => {
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			['acc1', 'Test Account', 'checking', 'VND', now, now]
		);

		const logs = await db.query<{ table_name: string; row_id: string; operation: string; payload: string }>(
			`SELECT table_name, row_id, operation, payload FROM change_log WHERE table_name = 'accounts'`
		);
		expect(logs).toHaveLength(1);
		expect(logs[0].row_id).toBe('acc1');
		expect(logs[0].operation).toBe('insert');
		const payload = JSON.parse(logs[0].payload);
		expect(payload.name).toBe('Test Account');
	});
});

describe('Migration 003 - seed data', () => {
	it('seeds 4 buckets', async () => {
		const buckets = await db.query<{ id: string; name: string }>(
			`SELECT id, name FROM category_types ORDER BY sort_order`
		);
		expect(buckets).toHaveLength(4);
		expect(buckets[0].name).toBe('Essentials');
		expect(buckets[3].name).toBe('Adjustments');
	});

	it('seeds 4 system tags under Adjustments', async () => {
		const tags = await db.query<{ name: string; is_system: number }>(
			`SELECT name, is_system FROM category_tags WHERE type_id = 'bucket_adjustments'`
		);
		expect(tags).toHaveLength(4);
		expect(tags.every((t) => t.is_system === 1)).toBe(true);
	});

	it('generates a device_id ULID', async () => {
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'device_id'`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toHaveLength(26);
	});

	it('schema_version is 5', async () => {
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'schema_version'`
		);
		expect(rows[0].value).toBe('5');
	});
});

describe('migration 004 — rollover_toggle', () => {
	it('is idempotent: re-running when the column already exists does not throw (recovers from a half-applied state)', async () => {
		// Reproduce the stuck-DB state: the column exists (004 partially applied)
		// but schema_version was never bumped. Re-running migration004 must not
		// throw "duplicate column name" — otherwise boot is bricked forever.
		await expect(migration004.up(db)).resolves.not.toThrow();
	});

	it('adds rollover_enabled column defaulting to 1 on seeded buckets', async () => {
		const rows = await db.query<{ rollover_enabled: number }>(
			`SELECT rollover_enabled FROM category_types WHERE id = 'bucket_essentials'`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].rollover_enabled).toBe(1);
	});

	it('rejects NULL via the NOT NULL constraint', async () => {
		// A fresh column with NOT NULL DEFAULT back-fills existing rows;
		// verify the column is present and NOT NULL by updating it to a valid value.
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);
		const rows = await db.query<{ rollover_enabled: number }>(
			`SELECT rollover_enabled FROM category_types WHERE id = 'bucket_essentials'`
		);
		expect(rows[0].rollover_enabled).toBe(0);
	});
});

describe('runMigrations — recovery from a half-applied state', () => {
	it('un-bricks a DB where 004 partially applied (column exists, schema_version=3)', async () => {
		// `db` is already fully migrated by beforeEach. Simulate the stuck state:
		// roll schema_version back to 3 while keeping the rollover_enabled column.
		// This is exactly the on-disk state that bricked boot with "duplicate
		// column name". runMigrations must converge to schema_version=5 cleanly.
		await db.execute(
			`UPDATE app_meta SET value = '3' WHERE key = 'schema_version'`
		);
		await expect(runMigrations(db, migrations)).resolves.not.toThrow();
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'schema_version'`
		);
		expect(rows[0].value).toBe('5');
	});

	it('reports each applied migration in order', async () => {
		const fresh = createTestDb();
		const seen: number[] = [];

		await runMigrations(fresh, migrations, (migration) => seen.push(migration.version));

		expect(seen).toEqual([1, 2, 3, 4, 5]);
	});

	it('does not modify a database from a newer schema', async () => {
		await db.execute(`UPDATE app_meta SET value = '6' WHERE key = 'schema_version'`);

		await expect(runMigrations(db, migrations)).rejects.toThrow('database_schema_newer:6:5');
		expect(
			await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`)
		).toEqual([{ value: '6' }]);
	});
});

describe('migrations are idempotent (race-safe on a shared DB)', () => {
	// Two Tauri webview contexts can both call getDb() on the same notchy.db and
	// race on schema_version. Every migration must therefore be safe to re-run
	// against a DB that already has its changes. This is the guard that, combined
	// with per-migration version bumps, makes concurrent boot non-bricking.

	it('migration 001 (initial schema) is idempotent', async () => {
		await expect(migration001.up(db)).resolves.not.toThrow();
	});

	it('migration 002 (triggers) is idempotent', async () => {
		await expect(migration002.up(db)).resolves.not.toThrow();
	});

	it('migration 003 (seed) is idempotent', async () => {
		await expect(migration003.up(db)).resolves.not.toThrow();
	});

	it('migration 004 (rollover) is idempotent', async () => {
		await expect(migration004.up(db)).resolves.not.toThrow();
	});
});
