import type { DatabaseService } from './service';
import { createTauriDb } from './service';
import { createInMemoryDb } from './in-memory';
import { applyPragmas } from './pragmas';
import { runIntegrityCheck, checkOrphanedTransfers } from './integrity';
import { runMigrations } from './migrations/runner';
import { migrations } from './migrations/index';

let _db: DatabaseService | null = null;

/**
 * Tauri v2 injects `window.__TAURI_INTERNALS__` into its webview. When it's
 * absent we're in a plain browser (Playwright / dev / preview) where the Tauri
 * SQL plugin cannot function, so fall back to the in-memory sql.js service.
 */
function isTauri(): boolean {
	return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export async function getDb(): Promise<DatabaseService> {
	if (_db) return _db;
	_db = isTauri() ? await createTauriDb('sqlite:notchy.db') : await createInMemoryDb();
	await applyPragmas(_db);
	await runIntegrityCheck(_db);
	await runMigrations(_db, migrations);
	await checkOrphanedTransfers(_db);
	return _db;
}

export async function closeDb(): Promise<void> {
	if (_db) {
		await _db.close();
		_db = null;
	}
}
