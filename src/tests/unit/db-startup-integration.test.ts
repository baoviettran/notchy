import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb, createTestDbFromPath } from './helpers/test-db';
import { closeDb, initializeDb, openCurrentDb } from '$lib/db';
import { openConnection } from '$lib/db/platform';

// The platform adapter's openConnection is the connection-open seam: replace it
// with a spy that returns a real SQLite connection (better-sqlite3), so the
// initialization ownership tests prove the singleton behavior against the real
// migration pipeline while controlling exactly which file gets opened. The
// non-open functions keep their web-mode behavior (synthetic paths, 'web-test').
vi.mock('$lib/db/platform', () => ({
	openConnection: vi.fn(),
	getDatabasePaths: async () => ({
		dataDir: '/web',
		databasePath: '/web/notchy.db',
		routineBackupDir: '/web/backups',
		upgradeBackupDir: '/web/backups/upgrades'
	}),
	getInstalledAppVersion: async () => 'web-test',
	ensureDirectory: async () => {},
	openReadOnlyDatabase: async () => {
		throw new Error('openReadOnlyDatabase should not be called for a fresh schema');
	},
	listUpgradeBackupRecords: async () => [],
	removeFile: async () => {}
}));

const tempDirectories: string[] = [];

afterEach(async () => {
	// closeDb resets the module-level _db/initialization state for the next test.
	await closeDb().catch(() => {});
	await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

beforeEach(() => {
	vi.mocked(openConnection).mockReset();
});

async function readSchemaVersion(path: string): Promise<number> {
	const db = createTestDbFromPath(path);
	try {
		const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`);
		return Number(rows[0].value);
	} finally {
		await db.close();
	}
}

/** Copy the released v004 fixture to a temp dir (never open the committed fixture for writing). */
async function copyV004Fixture(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'notchy-db-startup-'));
	tempDirectories.push(directory);
	const path = join(directory, 'notchy.db');
	await copyFile(fileURLToPath(new URL('../fixtures/migrations/v004.sqlite', import.meta.url)), path);
	return path;
}

describe('main-window initialization ownership', () => {
	it('coalesces concurrent main-window initialization', async () => {
		vi.mocked(openConnection).mockImplementation(async () => createTestDb());

		const [first, second] = await Promise.all([initializeDb(() => {}), initializeDb(() => {})]);

		expect(first).toEqual(second);
		expect(openConnection).toHaveBeenCalledTimes(1);
		expect(first).toMatchObject({ schemaVersion: 5, migratedFrom: null, backup: null });
	});

	it('quick access rejects an older schema without migrating it', async () => {
		const fixture = await copyV004Fixture();
		vi.mocked(openConnection).mockImplementation(async () => createTestDbFromPath(fixture));

		await expect(openCurrentDb()).rejects.toMatchObject({ code: 'database_update_required' });
		await expect(readSchemaVersion(fixture)).resolves.toBe(4);
	});
});
