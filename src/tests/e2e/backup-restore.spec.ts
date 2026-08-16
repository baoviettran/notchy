import { test, expect } from './fixtures/tauri-mock';
import { onboard } from './helpers/ui';
import { writeVirtualFs, listVirtualFs, flushDb } from './fixtures/tauri-mock';
import type { Page } from '@playwright/test';

const APP_DATA_DIR = '/notchy/appdata';
const BACKUP_DIR = APP_DATA_DIR + '/backups';

// Shape of the accounts row we INSERT to diverge the live DB from the backup.
// Mirrors the NOT NULL columns the onboarding migration creates.
const DIVERGE_INSERT = `INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
	VALUES ('01DIVERGE', 'Diverged', 'checking', 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`;

// Read the app-exposed test hooks inside the page (functions can't be passed
// across page.evaluate — structured clone drops them). db.svelte.ts gates these
// on the e2e mock marker, so they exist only under Playwright + the mock.
function hookExpr(fnBody: string): string {
	return `(async () => {
		const h = window.__notchyTestHooks;
		if (!h) throw new Error('__notchyTestHooks not exposed (mock marker missing?)');
		${fnBody}
	})()`;
}

async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return page.evaluate(hookExpr(`return (await h.getDb()).query(${JSON.stringify(sql)});`)) as Promise<T[]>;
}

/**
 * backup / restore (Tauri IPC mock).
 *
 * Drives the REAL backup/restore plugin code (createBackup issues a real
 * VACUUM INTO; restoreCompatibleDatabase opens a real sql.js connection,
 * validates against the supported schema range, and copies bytes via the FS
 * plugin) against the Task 8 Tauri IPC mock. The OS file-picker dialog is
 * scoped out — we invoke the library functions directly via page.evaluate and
 * assert on the virtual filesystem / live DB state.
 *
 * Mock path normalization: the mock strips '?readonly' (and the 'sqlite:'
 * prefix for FS lookups) so a readonly candidate-open of a backup file resolves
 * to the same bytes the VACUUM INTO override / writeVirtualFs placed in the
 * virtual FS. The virtual FS is per-page-load (a Map in the page context) and
 * does NOT survive page.reload(); the round-trip tests enable persist mode so
 * the restore's copyFile (mirrored into IndexedDB by the mock) rehydrates on
 * reload — mirroring a real disk write that survives process restart.
 */
test.describe('backup -> diverge -> restore round-trip', () => {
	// Persist mode so the restored live-DB bytes (copy_file mirrors them into
	// IndexedDB) survive the post-restore page.reload().
	test.use({ tauriMockOptions: { persist: true } });

	test('restores the pre-diverge state after reload', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'RoundTrip' });

		// Capture the live account ids/count BEFORE backup (post-onboarding).
		const beforeRows = await liveQuery<{ id: string }>(
			page,
			'SELECT id FROM accounts WHERE deleted_at IS NULL'
		);
		const beforeCount = beforeRows.length;
		expect(beforeCount).toBeGreaterThan(0);

		// Back up via the real createBackup -> VACUUM INTO (mock intercepts and
		// exports the live sql.js bytes into the virtual FS at the target path).
		const backupPath = await page.evaluate(
			hookExpr(`const db = await h.getDb(); return h.createBackup(db, ${JSON.stringify(BACKUP_DIR)});`)
		);
		expect(backupPath).toMatch(/notchy-backup-.*\.sqlite$/);

		// Diverge: add a second account directly via SQL through the live DB.
		await page.evaluate(
			hookExpr(`const db = await h.getDb(); await db.execute(${JSON.stringify(DIVERGE_INSERT)});`)
		);
		const divergedCount = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);
		expect(divergedCount[0].c).toBe(beforeCount + 1);

		// Restore from the backup file. restoreCompatibleDatabase opens the
		// candidate read-only, validates it against the supported range, closes
		// the live DB, and copies the backup bytes over the live path.
		const result = await page.evaluate(
			hookExpr(`return h.restoreCompatibleDatabase(${JSON.stringify(backupPath)});`)
		);
		expect(result).toEqual({ schemaVersion: 5 });

		// Reload so getDb() reopens the copied file (the live connection was
		// closed by restoreCompatibleDatabase; the copied bytes live in the
		// virtual FS at the live path, which loadDb rehydrates from after reload).
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		// The divergent account is gone; the original accounts are back.
		const afterRows = await liveQuery<{ id: string }>(
			page,
			'SELECT id FROM accounts WHERE deleted_at IS NULL'
		);
		const afterIds = afterRows.map((r) => r.id);
		expect(afterRows.length).toBe(beforeCount);
		expect(afterIds).not.toContain('01DIVERGE');
		for (const id of beforeRows.map((r) => r.id)) {
			expect(afterIds).toContain(id);
		}
	});

	test('restores a compatible schema-4 backup and migrates it forward on reload', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'V4Migrate' });

		// Capture the original account ids before downgrading the schema claim.
		const beforeRows = await liveQuery<{ id: string }>(
			page,
			'SELECT id FROM accounts WHERE deleted_at IS NULL'
		);
		const beforeIds = beforeRows.map((r) => r.id);
		expect(beforeIds.length).toBeGreaterThan(0);

		// Claim an older schema on the live DB, then back up those bytes so the
		// backup presents as a supported v4 database (schema-5 structure with a
		// v4 schema_version claim).
		await page.evaluate(
			hookExpr(`const db = await h.getDb(); await db.execute("UPDATE app_meta SET value='4' WHERE key='schema_version'");`)
		);
		const backupPath = await page.evaluate(
			hookExpr(`const db = await h.getDb(); return h.createBackup(db, ${JSON.stringify(BACKUP_DIR)});`)
		);
		expect(backupPath).toMatch(/notchy-backup-.*\.sqlite$/);

		// Restore the supported v4 backup.
		const result = await page.evaluate(
			hookExpr(`return h.restoreCompatibleDatabase(${JSON.stringify(backupPath)});`)
		);
		expect(result).toEqual({ schemaVersion: 4 });

		// The restored live-DB bytes (mirrored into IndexedDB by copy_file) must
		// survive reload; startup then detects schema 4, creates a verified
		// pre-upgrade backup, re-runs migration 005 (idempotent no-op), and
		// reaches schema 5 while preserving the original account rows.
		await flushDb(page);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		const afterRows = await liveQuery<{ id: string }>(
			page,
			'SELECT id FROM accounts WHERE deleted_at IS NULL'
		);
		expect(afterRows.map((r) => r.id)).toEqual(expect.arrayContaining(beforeIds));

		// Forward migration completed: the live DB is back on the current schema.
		const schema = await liveQuery<{ value: string }>(
			page,
			"SELECT value FROM app_meta WHERE key = 'schema_version'"
		);
		expect(schema[0].value).toBe('5');
	});
});

test.describe('import rejection (Tauri IPC mock)', () => {
	test('corrupt import is rejected, live DB untouched', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'CorruptGuard' });

		const before = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);

		// Mint a sql.js DB that is structurally valid SQLite (so it opens) but
		// whose trailing bytes are truncated — PRAGMA integrity_check reports
		// corruption instead of 'ok', so validateDatabase maps it to backup_corrupt.
		const corruptBytes = await page.evaluate(async () => {
			const mock = (window as unknown as { __notchyMock?: { sqlReady: () => Promise<unknown> } })
				.__notchyMock;
			const SQL = (await mock!.sqlReady()) as {
				Database: new () => { run: (s: string, params?: unknown[]) => void; export: () => Uint8Array };
			};
			const db = new SQL.Database();
			db.run('CREATE TABLE junk (x INTEGER)');
			for (let i = 0; i < 50; i++) db.run('INSERT INTO junk VALUES (?)', [i]);
			const bytes = db.export();
			return Array.from(bytes.slice(0, bytes.length - 512));
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/corrupt.sqlite', new Uint8Array(corruptBytes));

		// page.evaluate rejects when the hook throws, so wrap the hook body in
		// .catch to surface the AppError code across the boundary.
		const result = await page.evaluate(
			hookExpr(`return h.restoreCompatibleDatabase(${JSON.stringify(APP_DATA_DIR + '/corrupt.sqlite')}).catch((e) => ({ error: { code: e?.code, message: e?.message } }));`)
		) as { error?: { code?: string; message?: string } };
		expect(result.error?.code).toBe('backup_corrupt');

		// Live DB unchanged: the restore path must never copyFile on validation
		// failure, so the account count is identical to before.
		const after = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);
		expect(after[0].c).toBe(before[0].c);
	});

	test('schema-version newer is rejected, live DB untouched', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'VersionGuard' });

		const before = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);

		// Build a full-shape DB (passes integrity + required-tables) but with a
		// schema_version newer than the app supports.
		const newerBytes = await page.evaluate(async () => {
			const mock = (window as unknown as { __notchyMock?: { sqlReady: () => Promise<unknown> } })
				.__notchyMock;
			const SQL = (await mock!.sqlReady()) as {
				Database: new () => { run: (s: string) => void; export: () => Uint8Array };
			};
			const db = new SQL.Database();
			db.run('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)');
			db.run('CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, currency TEXT)');
			db.run('CREATE TABLE transactions (id TEXT)');
			db.run('CREATE TABLE category_types (id TEXT)');
			db.run('CREATE TABLE category_tags (id TEXT)');
			db.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '6')");
			return Array.from(db.export());
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/wrongver.sqlite', new Uint8Array(newerBytes));

		const result = await page.evaluate(
			hookExpr(`return h.restoreCompatibleDatabase(${JSON.stringify(APP_DATA_DIR + '/wrongver.sqlite')}).catch((e) => ({ error: { code: e?.code, message: e?.message } }));`)
		) as { error?: { code?: string; message?: string } };
		expect(result.error?.code).toBe('backup_schema_newer');

		// Live DB unchanged: validation failed, so restoreCompatibleDatabase must
		// never reach copyFile. The account count is identical to before.
		const after = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);
		expect(after[0].c).toBe(before[0].c);
	});
});

/**
 * Auto-backup runs on app launch when last_backup_at is stale. This needs a
 * custom seedMeta (old last_backup_at) injected before the page loads, so it
 * lives in its own describe with test.use({ tauriMockOptions }).
 */
test.describe('auto-backup on launch', () => {
	test.use({ tauriMockOptions: { seedMeta: { last_backup_at: '2020-01-01T00:00:00.000Z' } } });

	test('writes a backup file to the virtual FS', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'AutoBak' });

		// runAutoBackup is fire-and-forget during dbStore.init(); poll the
		// virtual FS until a notchy-backup-*.sqlite file appears under backups/.
		await expect.poll(async () => listVirtualFs(page, BACKUP_DIR), { timeout: 10_000 }).toEqual(
			expect.arrayContaining([expect.stringMatching(/notchy-backup-.*\.sqlite$/)])
		);
	});
});
