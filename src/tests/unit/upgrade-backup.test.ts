import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});

describe('createVerifiedUpgradeBackup', () => {
	it('creates and verifies a real pre-upgrade backup from the released v004 fixture', async () => {
		const { db: sourceDb, directory } = await copyMigrationFixture('v004.sqlite');
		const backupDir = join(directory, 'backups');

		const record = await createVerifiedUpgradeBackup(sourceDb, {
			backupDir,
			sourceSchema: 4,
			targetSchema: 5,
			sourceAppVersion: '0.1.3',
			createdAt: new Date('2026-08-15T10:30:00.000Z'),
			openReadOnly: async (backupPath) => {
				const backupDb = createTestDbFromPath(backupPath);
				openedDbs.push(backupDb);
				return backupDb;
			}
		});

		expect(record).toMatchObject({ sourceSchema: 4, targetSchema: 5, verified: true });
		expect(record.path).toContain(
			'notchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-15T10-30-00-000Z.sqlite'
		);
	});

	it('rejects a corrupt verification copy before any migration callback can run', async () => {
		const sourceDb = createTestDb();
		await runMigrations(sourceDb, migrations);
		openedDbs.push(sourceDb);

		const directory = await mkdtemp(join(tmpdir(), 'notchy-upgrade-corrupt-'));
		temporaryPaths.push(directory);
		const backupDir = join(directory, 'backups');
		const corruptPath = join(directory, 'corrupt.sqlite');
		await writeFile(corruptPath, 'not a sqlite database');
		const migrationCallback = vi.fn();

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
					return corruptDb;
				}
			})
		).rejects.toThrow();

		expect(migrationCallback).not.toHaveBeenCalled();
	});
});

describe('parseUpgradeBackupName', () => {
	it('parses a valid upgrade backup filename and rejects non-upgrade files', () => {
		expect(
			parseUpgradeBackupName(
				'/tmp/notchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-15T10-30-00-000Z.sqlite'
			)
		).toEqual({
			sourceSchema: 4,
			targetSchema: 5,
			sourceAppVersion: '0.1.3',
			createdAt: '2026-08-15T10:30:00.000Z'
		});
		expect(parseUpgradeBackupName('/tmp/notchy-backup-2026-08-15T10-30-00-000Z.sqlite')).toBeNull();
	});
});

describe('getUpgradeBackupsToDelete', () => {
	it('keeps the newest two backups per source schema', () => {
		const records = [
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
				path: '/backup/v4-oldest.sqlite',
				createdAt: '2026-08-15T10:30:00.000Z',
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
