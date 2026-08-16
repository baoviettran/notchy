import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, createTestDbFromPath } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import {
	createVerifiedUpgradeBackup,
	getUpgradeBackupsToDelete,
	parseUpgradeBackupName,
	validateDatabase
} from '$lib/backup';

let db: DatabaseService;
const temporaryPaths: string[] = [];
const openedDbs: DatabaseService[] = [];

afterEach(async () => {
	await Promise.all(openedDbs.splice(0).map((openedDb) => openedDb.close().catch(() => {})));
	await Promise.all(temporaryPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })));
});

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

async function copyMigrationFixture(name: string): Promise<{ db: DatabaseService; directory: string; path: string }> {
	const directory = await mkdtemp(join(tmpdir(), 'notchy-upgrade-fixture-'));
	temporaryPaths.push(directory);
	const fixturePath = join(directory, name);
	await copyFile(fileURLToPath(new URL(`../fixtures/migrations/${name}`, import.meta.url)), fixturePath);
	const fixtureDb = createTestDbFromPath(fixturePath);
	openedDbs.push(fixtureDb);
	return { db: fixtureDb, directory, path: fixturePath };
}

describe('validateDatabase', () => {
	it('accepts an exact source schema for upgrade verification', async () => {
		expect(await validateDatabase(db, { exact: 5 })).toEqual({ valid: true, schemaVersion: 5 });
	});

	it('accepts supported older backups and rejects newer backups', async () => {
		await db.execute("UPDATE app_meta SET value = '4' WHERE key = 'schema_version'");
		expect(await validateDatabase(db, { min: 3, max: 5 })).toEqual({ valid: true, schemaVersion: 4 });

		await db.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
		expect(await validateDatabase(db, { min: 3, max: 5 })).toEqual({
			valid: false,
			code: 'schema_newer',
			schemaVersion: 6
		});
	});


	it('accepts exact min/max boundaries and rejects malformed schema metadata variants', async () => {
		expect(await validateDatabase(db, { min: 5, max: 5 })).toEqual({ valid: true, schemaVersion: 5 });

		const noAppMetaDb = createTestDb();
		openedDbs.push(noAppMetaDb);
		await noAppMetaDb.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
		expect(await validateDatabase(noAppMetaDb, { exact: 5 })).toEqual({
			valid: false,
			code: 'missing_schema_version'
		});

		const malformedSchemaDb = createTestDb();
		openedDbs.push(malformedSchemaDb);
		await malformedSchemaDb.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await malformedSchemaDb.execute("INSERT INTO app_meta (key, value) VALUES ('schema_version', 'five')");
		expect(await validateDatabase(malformedSchemaDb, { exact: 5 })).toEqual({
			valid: false,
			code: 'missing_schema_version'
		});

		const duplicateSchemaDb = createTestDb();
		openedDbs.push(duplicateSchemaDb);
		await duplicateSchemaDb.execute('CREATE TABLE app_meta (key TEXT, value TEXT NOT NULL)');
		await duplicateSchemaDb.execute("INSERT INTO app_meta (key, value) VALUES ('schema_version', '5')");
		await duplicateSchemaDb.execute("INSERT INTO app_meta (key, value) VALUES ('schema_version', '5')");
		expect(await validateDatabase(duplicateSchemaDb, { exact: 5 })).toEqual({
			valid: false,
			code: 'missing_schema_version'
		});
	});

	it('reports corrupt databases when integrity check returns a failing row or no rows', async () => {
		const fakeCorruptDb = {
			query: async (sql: string) => {
				if (sql === 'PRAGMA integrity_check') return [{ integrity_check: 'not ok' }];
				throw new Error(`unexpected query: ${sql}`);
			}
		} as unknown as DatabaseService;
		expect(await validateDatabase(fakeCorruptDb, { exact: 5 })).toEqual({ valid: false, code: 'corrupt' });

		const fakeEmptyIntegrityDb = {
			query: async (sql: string) => {
				if (sql === 'PRAGMA integrity_check') return [];
				throw new Error(`unexpected query: ${sql}`);
			}
		} as unknown as DatabaseService;
		expect(await validateDatabase(fakeEmptyIntegrityDb, { exact: 5 })).toEqual({ valid: false, code: 'corrupt' });
	});

	it('rejects corrupt, mismatched, too-old, missing-schema, and missing-table databases', async () => {
		const corruptDir = await mkdtemp(join(tmpdir(), 'notchy-upgrade-invalid-'));
		temporaryPaths.push(corruptDir);
		const corruptPath = join(corruptDir, 'corrupt.sqlite');
		await writeFile(corruptPath, 'not a sqlite database');
		const corruptDb = createTestDbFromPath(corruptPath);
		openedDbs.push(corruptDb);
		expect(await validateDatabase(corruptDb, { exact: 5 })).toEqual({ valid: false, code: 'corrupt' });

		await db.execute("UPDATE app_meta SET value = '4' WHERE key = 'schema_version'");
		expect(await validateDatabase(db, { exact: 5 })).toEqual({
			valid: false,
			code: 'schema_mismatch',
			schemaVersion: 4
		});
		expect(await validateDatabase(db, { min: 5, max: 6 })).toEqual({
			valid: false,
			code: 'schema_too_old',
			schemaVersion: 4
		});

		const missingSchemaDb = createTestDb();
		openedDbs.push(missingSchemaDb);
		await missingSchemaDb.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		expect(await validateDatabase(missingSchemaDb, { exact: 5 })).toEqual({
			valid: false,
			code: 'missing_schema_version'
		});

		await db.execute('DROP TABLE category_tags');
		expect(await validateDatabase(db, { exact: 4 })).toEqual({
			valid: false,
			code: 'missing_table',
			schemaVersion: 4,
			table: 'category_tags'
		});
	});
});

describe('createVerifiedUpgradeBackup', () => {
	it('creates and verifies a real pre-upgrade backup from the released v004 fixture', async () => {
		const { db: sourceDb, directory } = await copyMigrationFixture('v004.sqlite');
		const backupDir = join(directory, "backup's", 'nested');
		let closed = false;

		const record = await createVerifiedUpgradeBackup(sourceDb, {
			backupDir,
			sourceSchema: 4,
			targetSchema: 5,
			sourceAppVersion: '0.1.3/beta',
			createdAt: new Date('2026-08-15T10:30:00.000Z'),
			openReadOnly: async (backupPath) => {
				const backupDb = createTestDbFromPath(backupPath);
				openedDbs.push(backupDb);
				const originalClose = backupDb.close.bind(backupDb);
				return Object.assign(backupDb, {
					close: async () => {
						closed = true;
						await originalClose();
					}
				});
			}
		});

		expect(record).toMatchObject({ sourceSchema: 4, targetSchema: 5, verified: true });
		expect(record.path).toContain(
			"notchy-pre-upgrade-v4-to-v5-0.1.3_beta-2026-08-15T10-30-00-000Z.sqlite"
		);
		expect(record.path).toContain("backup's/nested");
		expect(closed).toBe(true);
	});

	it('rejects a corrupt verification copy with an exact AppError payload and still closes it', async () => {
		const sourceDb = createTestDb();
		await runMigrations(sourceDb, migrations);
		openedDbs.push(sourceDb);

		const directory = await mkdtemp(join(tmpdir(), 'notchy-upgrade-corrupt-'));
		temporaryPaths.push(directory);
		const backupDir = join(directory, 'backups');
		const corruptPath = join(directory, 'corrupt.sqlite');
		await writeFile(corruptPath, 'not a sqlite database');
		let closed = false;

		await expect(
			createVerifiedUpgradeBackup(sourceDb, {
				backupDir,
				sourceSchema: 5,
				targetSchema: 6,
				sourceAppVersion: '0.1.4-dev',
				createdAt: new Date('2026-08-15T10:30:00.000Z'),
				openReadOnly: async () => {
					const corruptDb = createTestDbFromPath(corruptPath);
					openedDbs.push(corruptDb);
					const originalClose = corruptDb.close.bind(corruptDb);
					return Object.assign(corruptDb, {
						close: async () => {
							closed = true;
							await originalClose();
						}
					});
				}
			})
		).rejects.toMatchObject({
			code: 'upgrade_backup_verification_failed',
			params: { code: 'corrupt' }
		});

		expect(closed).toBe(true);
	});

	it('rejects a schema-mismatched verification copy with the mismatch code', async () => {
		const { db: sourceDb, directory } = await copyMigrationFixture('v004.sqlite');
		const backupDir = join(directory, 'backups');

		await expect(
			createVerifiedUpgradeBackup(sourceDb, {
				backupDir,
				sourceSchema: 5,
				targetSchema: 6,
				sourceAppVersion: '0.1.3',
				createdAt: new Date('2026-08-15T10:30:00.000Z'),
				openReadOnly: async (backupPath) => {
					const backupDb = createTestDbFromPath(backupPath);
					openedDbs.push(backupDb);
					return backupDb;
				}
			})
		).rejects.toMatchObject({
			code: 'upgrade_backup_verification_failed',
			params: { code: 'schema_mismatch' }
		});
	});
});

describe('parseUpgradeBackupName', () => {
	it('parses a valid upgrade backup filename and rejects non-upgrade files', () => {
		expect(
			parseUpgradeBackupName(
				'/tmp/notchy-pre-upgrade-v12-to-v34-0.1.3-2026-08-15T10-30-00-000Z.sqlite'
			)
		).toEqual({
			sourceSchema: 12,
			targetSchema: 34,
			sourceAppVersion: '0.1.3',
			createdAt: '2026-08-15T10:30:00.000Z'
		});
		expect(parseUpgradeBackupName('/tmp/notchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-15T10-30-00-000Z.sqlite.bak')).toBeNull();
		expect(parseUpgradeBackupName('/tmp/xnotchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-15T10-30-00-000Z.sqlite')).toBeNull();
		expect(parseUpgradeBackupName('/tmp/notchy-backup-2026-08-15T10-30-00-000Z.sqlite')).toBeNull();
	});
});

describe('getUpgradeBackupsToDelete', () => {
	it('keeps the newest two backups per source schema regardless of input order', () => {
		const records = [
			{
				path: '/backup/v4-oldest.sqlite',
				createdAt: '2026-08-15T10:30:00.000Z',
				sourceSchema: 4,
				targetSchema: 5,
				sourceAppVersion: '0.1.3',
				verified: true as const
			},
			{
				path: '/backup/v4-newest.sqlite',
				createdAt: '2026-08-15T10:32:00.000Z',
				sourceSchema: 4,
				targetSchema: 5,
				sourceAppVersion: '0.1.3',
				verified: true as const
			},
			{
				path: '/backup/v4-middle.sqlite',
				createdAt: '2026-08-15T10:31:00.000Z',
				sourceSchema: 4,
				targetSchema: 5,
				sourceAppVersion: '0.1.3',
				verified: true as const
			},
			{
				path: '/backup/v3-newest.sqlite',
				createdAt: '2026-08-14T10:31:00.000Z',
				sourceSchema: 3,
				targetSchema: 5,
				sourceAppVersion: '0.1.0',
				verified: true as const
			},
			{
				path: '/backup/v3-oldest.sqlite',
				createdAt: '2026-08-14T10:30:00.000Z',
				sourceSchema: 3,
				targetSchema: 5,
				sourceAppVersion: '0.1.0',
				verified: true as const
			}
		];

		expect(getUpgradeBackupsToDelete(records)).toEqual(['/backup/v4-oldest.sqlite']);
	});
});
