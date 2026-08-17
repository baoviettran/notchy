/**
 * Database entry point — returns an AppDatabase (domain port).
 *
 * Under Tauri: NativeDatabaseClient wraps invoke() calls to Rust.
 * Under browser (Vitest / Playwright): BrowserDatabaseClient owns sql.js.
 *
 * The Rust side owns the full lifecycle (integrity, migration, backup).
 * The JS side only calls `database_initialize` to trigger it.
 */
import type { AppDatabase } from './client';
import { isTauri } from './platform';
import { NativeDatabaseClient, databaseInitialize, databaseRetry, databaseStatus } from './native/client';
import type { DatabaseStatus } from './native/client';

export { isTauri };
export type { AppDatabase } from './client';
export { databaseInitialize, databaseRetry, databaseStatus } from './native/client';
export type { DatabaseStatus } from './native/client';

// Re-export platform utilities still needed by backup/restore.
export { getDatabasePaths, getInstalledAppVersion, openBackupFolder } from './platform';

let _db: AppDatabase | null = null;

/**
 * Return the AppDatabase singleton. Under Tauri this is the
 * NativeDatabaseClient (Rust handles initialization). Under browser
 * this is the BrowserDatabaseClient (sql.js in-memory).
 */
export function getDb(): AppDatabase {
	if (!_db) throw new Error('database not initialized — call initDb() first');
	return _db;
}

/**
 * Initialize the database for the current platform.
 *
 * - Tauri: creates NativeDatabaseClient (no JS startup needed — Rust
 *   handles integrity, migration, backup via `database_initialize`).
 * - Browser: runs the full JS startup pipeline (sql.js in-memory).
 */
export async function initDb(onStage?: (stage: string) => void): Promise<void> {
	if (_db) return;

	if (isTauri()) {
		_db = new NativeDatabaseClient();
		// Trigger Rust lifecycle — callers should await databaseInitialize()
		// separately to get typed status events.
		return;
	}

	// Browser fallback: sql.js in-memory with full JS startup pipeline.
	const { applyPragmas } = await import('./browser/pragmas');
	const { runIntegrityCheck, checkOrphanedTransfers } = await import('./browser/integrity');
	const { runMigrations } = await import('./browser/migrations/runner');
	const { migrations, LATEST_SCHEMA_VERSION } = await import('./browser/migrations/index');
	const { inspectSchema } = await import('./browser/schema');
	const { createInMemoryDb } = await import('./browser/in-memory');
	const { prepareDatabase } = await import('./startup');
	const { BrowserDatabaseClient } = await import('./browser/client');

	const db = await createInMemoryDb();
	await applyPragmas(db);

	const dependencies = {
		latestSchemaVersion: LATEST_SCHEMA_VERSION,
		appVersion: 'web-test',
		liveDatabasePath: '/web/notchy.db',
		now: () => new Date(),
		createUpgradeBackup: async (sourceSchema: number) => ({
			path: '/web/backups/upgrades/test.zip',
			sourceSchema,
			targetSchema: LATEST_SCHEMA_VERSION,
			sourceAppVersion: 'web-test',
			createdAt: new Date().toISOString(),
			verified: true as const,
		}),
		runMigrations: () => runMigrations(db, migrations),
		verifyAfterMigration: async () => {
			await runIntegrityCheck(db);
			await checkOrphanedTransfers(db);
		},
	};

	type StartupStage = 'checking' | 'backing_up' | 'migrating' | 'verifying' | 'ready' | 'recovery_required';
	await prepareDatabase(db, dependencies, onStage as ((stage: StartupStage) => void) | undefined);
	_db = new BrowserDatabaseClient(db);
}

/**
 * Close the database connection. Under Tauri this is a no-op (Rust owns
 * the connection). Under browser this closes the sql.js handle.
 */
export async function closeDb(): Promise<void> {
	_db = null;
}
