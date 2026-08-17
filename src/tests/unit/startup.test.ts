import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, createTestDbFromPath } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { runIntegrityCheck } from '$lib/db/integrity';
import {
	prepareDatabase,
	DatabaseStartupError,
	type StartupDependencies
} from '$lib/db';
import type { DatabaseService } from '$lib/db';
import type { UpgradeBackupRecord } from '$lib/backup/upgrade';

const temporaryPaths: string[] = [];
const openedDbs: DatabaseService[] = [];

afterEach(async () => {
	await Promise.all(openedDbs.splice(0).map((db) => db.close().catch(() => {})));
	await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function trackDb(db: DatabaseService): DatabaseService {
	openedDbs.push(db);
	return db;
}

function verifiedRecord(): UpgradeBackupRecord {
	return {
		path: '/tmp/notchy-backups/notchy-pre-upgrade-v4-to-v5-0.1.4-2026-08-15T11-00-00-000Z.sqlite',
		createdAt: '2026-08-15T11:00:00.000Z',
		sourceSchema: 4,
		targetSchema: 5,
		sourceAppVersion: '0.1.4',
		verified: true
	};
}

interface DependencyOverrides {
	backup?: UpgradeBackupRecord;
	failBackup?: Error;
	failMigration?: Error;
	failVerify?: Error;
}

function makeDependencies(
	db: DatabaseService,
	events: string[],
	overrides: DependencyOverrides = {}
): StartupDependencies {
	return {
		latestSchemaVersion: 5,
		appVersion: '0.1.4',
		liveDatabasePath: '/data/notchy.db',
		now: () => new Date('2026-08-15T11:00:00.000Z'),
		createUpgradeBackup: async () => {
			events.push('backup');
			if (overrides.failBackup) throw overrides.failBackup;
			return overrides.backup ?? verifiedRecord();
		},
		runMigrations: async () => {
			events.push('migrate');
			if (overrides.failMigration) throw overrides.failMigration;
			await runMigrations(db, migrations);
		},
		verifyAfterMigration: async () => {
			events.push('verify');
			if (overrides.failVerify) throw overrides.failVerify;
			await runIntegrityCheck(db);
		}
	};
}

async function copyV004Fixture(): Promise<{ db: DatabaseService; path: string }> {
	const directory = await mkdtemp(join(tmpdir(), 'notchy-startup-fixture-'));
	temporaryPaths.push(directory);
	const path = join(directory, 'v004.sqlite');
	await copyFile(fileURLToPath(new URL(`../fixtures/migrations/v004.sqlite`, import.meta.url)), path);
	return { db: trackDb(createTestDbFromPath(path)), path };
}

async function readAppMeta(db: DatabaseService): Promise<Record<string, string>> {
	const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM app_meta`);
	return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('expected the promise to reject');
}

describe('prepareDatabase', () => {
	it('sequences checking, backup, migration, verification, and ready on an older database', async () => {
		const { db } = await copyV004Fixture();
		const events: string[] = [];
		const record = verifiedRecord();

		const result = await prepareDatabase(db, makeDependencies(db, events), (stage) => events.push(stage));

		expect(events).toEqual([
			'checking', 'backing_up', 'backup', 'migrating', 'migrate', 'verifying', 'verify', 'ready'
		]);
		expect(result).toMatchObject({ schemaVersion: 5, migratedFrom: 4, backup: record });
	});

	it('writes startup and upgrade metadata on an older database', async () => {
		const { db } = await copyV004Fixture();
		const record = verifiedRecord();

		await prepareDatabase(db, makeDependencies(db, []), () => {});

		expect(await readAppMeta(db)).toMatchObject({
			schema_version: '5',
			last_successful_app_version: '0.1.4',
			last_successful_schema_version: '5',
			last_successful_startup_at: '2026-08-15T11:00:00.000Z',
			last_migrated_from_schema: '4',
			last_upgrade_backup_path: record.path
		});
	});

	it('migrates a fresh database without creating a pre-upgrade backup', async () => {
		const db = trackDb(createTestDb());
		const events: string[] = [];
		const backupSpy = vi.fn(async () => verifiedRecord());

		const result = await prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: backupSpy,
			runMigrations: async () => {
				events.push('migrate');
				await runMigrations(db, migrations);
			},
			verifyAfterMigration: async () => {
				events.push('verify');
				await runIntegrityCheck(db);
			}
		}, (stage) => events.push(stage));

		expect(events).toEqual(['checking', 'migrating', 'migrate', 'verifying', 'verify', 'ready']);
		expect(backupSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({ schemaVersion: 5, migratedFrom: null, backup: null });

		const meta = await readAppMeta(db);
		expect(meta.last_successful_app_version).toBe('0.1.4');
		expect(meta.last_migrated_from_schema).toBeUndefined();
		expect(meta.last_upgrade_backup_path).toBeUndefined();
	});

	it('runs only verification on a current database and preserves the last upgrade record', async () => {
		const db = trackDb(createTestDb());
		await runMigrations(db, migrations);
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_migrated_from_schema', '4')`);
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_upgrade_backup_path', '/old/backup.sqlite')`);

		const events: string[] = [];
		const backupSpy = vi.fn(async () => verifiedRecord());
		const migrateSpy = vi.fn(async () => {
			events.push('migrate');
			await runMigrations(db, migrations);
		});

		const result = await prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: backupSpy,
			runMigrations: migrateSpy,
			verifyAfterMigration: async () => {
				events.push('verify');
				await runIntegrityCheck(db);
			}
		}, (stage) => events.push(stage));

		expect(events).toEqual(['checking', 'verifying', 'verify', 'ready']);
		expect(backupSpy).not.toHaveBeenCalled();
		expect(migrateSpy).not.toHaveBeenCalled();
		expect(result).toMatchObject({ schemaVersion: 5, migratedFrom: null, backup: null });

		const meta = await readAppMeta(db);
		expect(meta.last_successful_app_version).toBe('0.1.4');
		expect(meta.last_migrated_from_schema).toBe('4');
		expect(meta.last_upgrade_backup_path).toBe('/old/backup.sqlite');
	});

	it('rejects a newer database without calling migration and leaves it unmodified', async () => {
		const db = trackDb(createTestDb());
		await runMigrations(db, migrations);
		await db.execute(`UPDATE app_meta SET value = '6' WHERE key = 'schema_version'`);
		const migrateSpy = vi.fn(async () => {});
		const verifySpy = vi.fn(async () => {});

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => verifiedRecord(),
			runMigrations: migrateSpy,
			verifyAfterMigration: verifySpy
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect((error as DatabaseStartupError).name).toBe('DatabaseStartupError');
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'database_schema_newer',
				detectedSchemaVersion: 6,
				backupPath: null,
				detail: expect.any(String)
			}
		});
		expect(migrateSpy).not.toHaveBeenCalled();
		expect(verifySpy).not.toHaveBeenCalled();
		expect(await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`)).toEqual([
			{ value: '6' }
		]);
	});

	it('rejects an invalid schema without calling migration', async () => {
		const db = trackDb(createTestDb());
		await db.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
		const migrateSpy = vi.fn(async () => {});

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => verifiedRecord(),
			runMigrations: migrateSpy,
			verifyAfterMigration: async () => {}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'database_schema_invalid',
				detectedSchemaVersion: null,
				backupPath: null,
				detail: 'missing_schema_version'
			}
		});
		expect(migrateSpy).not.toHaveBeenCalled();
	});

	it('stops at backup failure without calling migration', async () => {
		const { db } = await copyV004Fixture();
		const migrateSpy = vi.fn(async () => {});

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => {
				throw new Error('backup boom');
			},
			runMigrations: migrateSpy,
			verifyAfterMigration: async () => {}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'upgrade_backup_failed',
				detectedSchemaVersion: 4,
				backupPath: null,
				detail: expect.stringContaining('backup boom')
			}
		});
		expect(migrateSpy).not.toHaveBeenCalled();
	});

	it('maps an integrity failure to database_corrupt before any backup or migration', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'notchy-startup-corrupt-'));
		temporaryPaths.push(directory);
		const path = join(directory, 'corrupt.sqlite');
		await writeFile(path, 'not a sqlite database');
		const db = trackDb(createTestDbFromPath(path));
		const backupSpy = vi.fn(async () => verifiedRecord());
		const migrateSpy = vi.fn(async () => {});

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: backupSpy,
			runMigrations: migrateSpy,
			verifyAfterMigration: async () => {}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'database_corrupt',
				detectedSchemaVersion: null,
				backupPath: null,
				detail: expect.any(String)
			}
		});
		expect(backupSpy).not.toHaveBeenCalled();
		expect(migrateSpy).not.toHaveBeenCalled();
	});

	it('leaves the source schema readable after a migration failure', async () => {
		const { db, path } = await copyV004Fixture();
		const record = verifiedRecord();

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => record,
			runMigrations: async () => {
				throw new Error('migration boom');
			},
			verifyAfterMigration: async () => {}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'migration_failed',
				detectedSchemaVersion: 4,
				backupPath: record.path,
				detail: expect.stringContaining('migration boom')
			}
		});

		await db.close();
		const reopened = trackDb(createTestDbFromPath(path));
		expect(await reopened.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`)).toEqual([
			{ value: '4' }
		]);
		expect(
			await reopened.query<{ id: string; amount: number }>(
				`SELECT id, amount FROM transactions WHERE id = 'txn_fixture_v004'`
			)
		).toEqual([{ id: 'txn_fixture_v004', amount: 987654321 }]);
	});

	it('maps a fresh-database migration failure to a null detected schema version', async () => {
		const db = trackDb(createTestDb());

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => verifiedRecord(),
			runMigrations: async () => {
				throw new Error('fresh migration boom');
			},
			verifyAfterMigration: async () => {}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'migration_failed',
				detectedSchemaVersion: null,
				backupPath: null,
				detail: expect.stringContaining('fresh migration boom')
			}
		});
	});

	it('clears stale upgrade metadata on a fresh database', async () => {
		const db = trackDb(createTestDb());

		await prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => verifiedRecord(),
			runMigrations: async () => {
				// A fresh DB has no app_meta at inspection time; the migration that
				// runs afterwards creates it. Simulate a migration that also writes
				// stale upgrade keys so the fresh-launch cleanup has something to
				// delete (the real migrations never write these keys).
				await db.execute(`CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
				await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')`);
				await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_migrated_from_schema', '4')`);
				await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_upgrade_backup_path', '/stale/backup.sqlite')`);
			},
			verifyAfterMigration: async () => {}
		}, () => {});

		const meta = await readAppMeta(db);
		expect(meta.last_successful_app_version).toBe('0.1.4');
		expect(meta.last_migrated_from_schema).toBeUndefined();
		expect(meta.last_upgrade_backup_path).toBeUndefined();
	});

	it('maps a post-migration verification failure to its own recovery code', async () => {
		const { db } = await copyV004Fixture();
		const record = verifiedRecord();

		const error = await captureError(prepareDatabase(db, {
			latestSchemaVersion: 5,
			appVersion: '0.1.4',
			liveDatabasePath: '/data/notchy.db',
			now: () => new Date('2026-08-15T11:00:00.000Z'),
			createUpgradeBackup: async () => record,
			runMigrations: async () => {
				await runMigrations(db, migrations);
			},
			verifyAfterMigration: async () => {
				throw new Error('verify boom');
			}
		}, () => {}));

		expect(error).toBeInstanceOf(DatabaseStartupError);
		expect(error as DatabaseStartupError).toMatchObject({
			recovery: {
				code: 'post_migration_verification_failed',
				detectedSchemaVersion: 4,
				backupPath: record.path,
				detail: expect.stringContaining('verify boom')
			}
		});
	});
});
