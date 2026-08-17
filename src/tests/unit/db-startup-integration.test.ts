import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, initDb, isTauri } from '$lib/db';
import { createTestDb } from './helpers/test-db';

// The platform adapter isTauri is the seam: mock it to control browser vs Tauri path.
vi.mock('$lib/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db')>();
	return {
		...actual,
		isTauri: vi.fn(() => false),
		getDatabasePaths: async () => ({
			dataDir: '/web',
			databasePath: '/web/notchy.db',
			routineBackupDir: '/web/backups',
			upgradeBackupDir: '/web/backups/upgrades'
		}),
		getInstalledAppVersion: async () => 'web-test',
		openBackupFolder: async () => {}
	};
});

// Mock sql.js in-memory to use better-sqlite3 instead (WASM unavailable in Vitest node env).
vi.mock('$lib/db/browser/in-memory', () => ({
	createInMemoryDb: async () => createTestDb()
}));

afterEach(async () => {
	await closeDb().catch(() => {});
});

beforeEach(() => {
	vi.mocked(isTauri).mockReset();
	vi.mocked(isTauri).mockReturnValue(false);
});

describe('browser initialization', () => {
	it('initializes a fresh in-memory database', async () => {
		await initDb();
		// If initDb completes without throwing, the database is ready.
		// The singleton guard means calling initDb again is a no-op.
	});

	it('is a no-op when already initialized', async () => {
		await initDb();
		// Second call should not throw or re-initialize.
		await initDb();
	});
});
