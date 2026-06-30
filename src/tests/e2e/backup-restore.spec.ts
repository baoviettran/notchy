import { test, expect } from './fixtures/tauri-mock';
import { onboard } from './helpers/ui';
import { writeVirtualFs, listVirtualFs } from './fixtures/tauri-mock';
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
 * VACUUM INTO; importDatabase opens a real sql.js connection, validates, and
 * copies bytes via the FS plugin) against the Task 8 Tauri IPC mock. The OS
 * file-picker dialog is scoped out — we invoke the library functions directly
 * via page.evaluate and assert on the virtual filesystem / live DB state.
 *
 * Mock path normalization: the mock strips '?readonly' (and the 'sqlite:'
 * prefix for FS lookups) so a readonly candidate-open of a backup file resolves
 * to the same bytes the VACUUM INTO override / writeVirtualFs placed in the
 * virtual FS. The virtual FS is per-page-load (a Map in the page context) and
 * does NOT survive page.reload(); the round-trip test enables persist mode so
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

		// Restore from the backup file. importDatabase opens the candidate
		// read-only, validates schema/version/tables, closes the live DB, and
		// copies the backup bytes over the live path.
		const result = await page.evaluate(
			hookExpr(`return h.importDatabase(${JSON.stringify(backupPath)}, 3);`)
		);
		expect(result).toEqual({ valid: true });

		// Reload so getDb() reopens the copied file (the live connection was
		// closed by importDatabase; the copied bytes live in the virtual FS at
		// the live path, which loadDb rehydrates from after the reload).
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
});

test.describe('import rejection (Tauri IPC mock)', () => {
	test('corrupt import is rejected, live DB untouched', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'CorruptGuard' });

		const before = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);

		// Mint a sql.js DB that is structurally valid SQLite but NOT a Notchy DB
		// (no app_meta / required tables) -> fails validateImport's table check.
		const corruptBytes = await page.evaluate(async () => {
			const mock = (window as unknown as { __notchyMock?: { sqlReady: () => Promise<unknown> } })
				.__notchyMock;
			const SQL = (await mock!.sqlReady()) as {
				Database: new () => { run: (s: string) => void; export: () => Uint8Array };
			};
			const db = new SQL.Database();
			db.run('CREATE TABLE junk (x INTEGER)');
			return Array.from(db.export());
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/corrupt.sqlite', new Uint8Array(corruptBytes));

		const result = await page.evaluate(
			hookExpr(`return h.importDatabase(${JSON.stringify(APP_DATA_DIR + '/corrupt.sqlite')}, 3);`)
		) as { valid: boolean; error?: string };
		expect(result.valid).toBe(false);

		// Live DB unchanged: the restore path must never copyFile on validation
		// failure, so the account count is identical to before.
		const after = await liveQuery<{ c: number }>(
			page,
			'SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL'
		);
		expect(after[0].c).toBe(before[0].c);
	});

	test('schema-version mismatch is rejected', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'VersionGuard' });

		// Build a full-shape DB (passes integrity + required-tables) but with a
		// schema_version the app does not expect.
		const mismatchBytes = await page.evaluate(async () => {
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
			db.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '99')");
			return Array.from(db.export());
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/wrongver.sqlite', new Uint8Array(mismatchBytes));

		const result = await page.evaluate(
			hookExpr(`return h.importDatabase(${JSON.stringify(APP_DATA_DIR + '/wrongver.sqlite')}, 3);`)
		) as { valid: boolean; error?: string };
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Schema version');
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
