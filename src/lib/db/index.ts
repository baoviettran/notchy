/**
 * Database entry point — returns an AppDatabase (domain port).
 *
 * Under Tauri: NativeDatabaseClient wraps invoke() calls to Rust.
 * Under browser (Vitest / Playwright): BrowserDatabaseClient owns sql.js.
 *
 * The Rust side owns the full lifecycle (integrity, migration, backup).
 * The JS side only calls `database_initialize` to trigger it.
 */
import type { UpgradeBackupRecord } from '$lib/backup/upgrade';
import { parseUpgradeBackupName } from '$lib/backup/upgrade';
import type { DatabaseService } from './browser/service';
import { createTauriDb, type QueryResult, type Row, uniqueSavepointName, TauriDatabase } from './browser/service';
import { createInMemoryDb } from './browser/in-memory';
import { runIntegrityCheck } from './browser/integrity';
import { inspectSchema, type SchemaInspection } from './browser/schema';
import type { AppDatabase } from './client';
import { NativeDatabaseClient, databaseInitialize, databaseRetry, databaseStatus } from './native/client';
import type { DatabaseStatus } from './native/client';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { databaseInitialize, databaseRetry, databaseStatus } from './native/client';
export type { DatabaseStatus } from './native/client';
export type { AppDatabase } from './client';
export type { DatabaseService, QueryResult, Row };
export { uniqueSavepointName, TauriDatabase, createTauriDb };

// ---------------------------------------------------------------------------
// Platform utilities (merged from ./platform.ts)
// ---------------------------------------------------------------------------

/**
 * Tauri v2 injects `window.__TAURI_INTERNALS__` into its webview. When it's
 * absent we're in a plain browser (Playwright / dev / preview) where the Tauri
 * SQL plugin cannot function, so fall back to the in-memory sql.js service.
 */
export function isTauri(): boolean {
	return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

export interface DatabasePaths {
	dataDir: string;
	databasePath: string;
	routineBackupDir: string;
	upgradeBackupDir: string;
}

/**
 * Derive the live DB and backup paths from the two base directories. The live
 * database must agree with where the connection actually opens: the
 * tauri-plugin-sql resolves `sqlite:notchy.db` relative to the app CONFIG dir,
 * so the DB lives at `configDir/notchy.db`, while backups stay below the app
 * DATA dir (design intent). Pure + sync so it is unit-testable without Tauri.
 */
export function computeDatabasePaths(dataDir: string, configDir: string): DatabasePaths {
	return {
		dataDir,
		databasePath: `${configDir}/notchy.db`,
		routineBackupDir: `${dataDir}/backups`,
		upgradeBackupDir: `${dataDir}/backups/upgrades`
	};
}

/**
 * Resolve the app-config/app-data directories and the paths derived from them.
 * In a plain browser (web build / E2E without Tauri) these are synthetic —
 * never call the Tauri path plugin — so startup can still report a stable live
 * path.
 */
export async function getDatabasePaths(): Promise<DatabasePaths> {
	if (!isTauri()) {
		return {
			dataDir: '/web',
			databasePath: '/web/notchy.db',
			routineBackupDir: '/web/backups',
			upgradeBackupDir: '/web/backups/upgrades'
		};
	}
	const { appDataDir, appConfigDir } = await import('@tauri-apps/api/path');
	const [dataDir, configDir] = await Promise.all([appDataDir(), appConfigDir()]);
	return computeDatabasePaths(dataDir, configDir);
}

export async function getInstalledAppVersion(): Promise<string> {
	if (!isTauri()) return 'web-test';
	const { getVersion } = await import('@tauri-apps/api/app');
	return getVersion();
}

/**
 * Connection-open seam. Startup (`initializeMainDatabase`) and quick access
 * (`openCurrentDb`) both open the live database through here; tests `vi.mock`
 * this function to inject a real SQLite connection and assert it runs exactly
 * once under concurrent initialization.
 */
export function openConnection(): Promise<DatabaseService> {
	return isTauri() ? createTauriDb('sqlite:notchy.db') : createInMemoryDb();
}

export async function ensureDirectory(path: string): Promise<void> {
	const { mkdir } = await import('@tauri-apps/plugin-fs');
	await mkdir(path, { recursive: true });
}

export async function openReadOnlyDatabase(path: string): Promise<DatabaseService> {
	// The `?readonly` suffix is not reliably honored by the Tauri SQL plugin on
	// this sqlx version — it can hang the load IPC. The backup/candidate files
	// are throwaway and only ever read (validateDatabase), so open the pool
	// without the suffix; SQLite's default open is harmless for validation.
	return createTauriDb(`sqlite:${path}`);
}

export async function openBackupFolder(path: string): Promise<void> {
	const { openPath } = await import('@tauri-apps/plugin-opener');
	await openPath(path);
}

export async function listUpgradeBackupRecords(path: string): Promise<UpgradeBackupRecord[]> {
	const { readDir } = await import('@tauri-apps/plugin-fs');
	const entries = await readDir(path);
	const records: UpgradeBackupRecord[] = [];
	for (const entry of entries) {
		if (!entry.name) continue;
		const filePath = `${path}/${entry.name}`;
		const parsed = parseUpgradeBackupName(filePath);
		if (!parsed) continue;
		records.push({ ...parsed, path: filePath, verified: true });
	}
	return records;
}

export async function removeFile(path: string): Promise<void> {
	const { remove } = await import('@tauri-apps/plugin-fs');
	await remove(path);
}

// ---------------------------------------------------------------------------
// Startup types and prepareDatabase (merged from ./startup.ts)
// ---------------------------------------------------------------------------

export type StartupStage = 'checking' | 'backing_up' | 'migrating' | 'verifying' | 'ready' | 'recovery_required';

export type StartupFailureCode =
	| 'database_corrupt'
	| 'database_schema_invalid'
	| 'database_schema_newer'
	| 'upgrade_backup_failed'
	| 'migration_failed'
	| 'post_migration_verification_failed';

export interface RecoveryContext {
	code: StartupFailureCode;
	appVersion: string;
	latestSchemaVersion: number;
	detectedSchemaVersion: number | null;
	liveDatabasePath: string;
	backupPath: string | null;
	detail: string;
}

export interface StartupSuccess {
	schemaVersion: number;
	migratedFrom: number | null;
	backup: UpgradeBackupRecord | null;
}

export interface StartupDependencies {
	latestSchemaVersion: number;
	appVersion: string;
	liveDatabasePath: string;
	now(): Date;
	createUpgradeBackup(sourceSchema: number): Promise<UpgradeBackupRecord>;
	runMigrations(): Promise<void>;
	verifyAfterMigration(): Promise<void>;
}

export class DatabaseStartupError extends Error {
	constructor(readonly recovery: RecoveryContext, options?: ErrorOptions) {
		super(recovery.code, options);
		this.name = 'DatabaseStartupError';
	}
}

/**
 * Coordinates protected database startup: integrity check, schema inspection,
 * mandatory pre-upgrade backup, migration, post-migration verification, and
 * startup metadata. Each failure boundary maps to a stable {@link StartupFailureCode}
 * so the recovery UI can distinguish corrupt, schema, backup, migration, and
 * verification failures. `detail` never carries SQL parameters or queried rows.
 */
export async function prepareDatabase(
	db: DatabaseService,
	dependencies: StartupDependencies,
	onStage: (stage: StartupStage) => void = () => {}
): Promise<StartupSuccess> {
	let backup: UpgradeBackupRecord | null = null;

	const fail = (
		code: StartupFailureCode,
		detectedSchemaVersion: number | null,
		detail: string
	): DatabaseStartupError =>
		new DatabaseStartupError({
			code,
			appVersion: dependencies.appVersion,
			latestSchemaVersion: dependencies.latestSchemaVersion,
			detectedSchemaVersion,
			liveDatabasePath: dependencies.liveDatabasePath,
			backupPath: backup?.path ?? null,
			detail
		});

	onStage('checking');
	try {
		await runIntegrityCheck(db);
	} catch (error) {
		throw fail('database_corrupt', null, String(error));
	}

	const inspection = await inspectSchema(db, dependencies.latestSchemaVersion);

	if (inspection.kind === 'newer') {
		throw fail('database_schema_newer', inspection.version, String(inspection.version));
	}
	if (inspection.kind === 'invalid') {
		throw fail('database_schema_invalid', null, inspection.reason);
	}

	const detectedSchemaVersion = inspection.kind === 'fresh' ? null : inspection.version;
	let migratedFrom: number | null = null;

	if (inspection.kind === 'older') {
		migratedFrom = inspection.version;
		onStage('backing_up');
		try {
			backup = await dependencies.createUpgradeBackup(inspection.version);
		} catch (error) {
			throw fail('upgrade_backup_failed', detectedSchemaVersion, String(error));
		}
	}

	if (inspection.kind === 'fresh' || inspection.kind === 'older') {
		onStage('migrating');
		try {
			await dependencies.runMigrations();
		} catch (error) {
			throw fail('migration_failed', detectedSchemaVersion, String(error));
		}
	}

	onStage('verifying');
	try {
		await dependencies.verifyAfterMigration();
	} catch (error) {
		throw fail('post_migration_verification_failed', detectedSchemaVersion, String(error));
	}

	await writeStartupMetadata(db, dependencies, inspection, migratedFrom, backup);
	onStage('ready');
	return { schemaVersion: dependencies.latestSchemaVersion, migratedFrom, backup };
}

async function writeStartupMetadata(
	db: DatabaseService,
	dependencies: StartupDependencies,
	inspection: SchemaInspection,
	migratedFrom: number | null,
	backup: UpgradeBackupRecord | null
): Promise<void> {
	await db.execute(
		`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?), (?, ?), (?, ?)`,
		[
			'last_successful_app_version', dependencies.appVersion,
			'last_successful_schema_version', String(dependencies.latestSchemaVersion),
			'last_successful_startup_at', dependencies.now().toISOString()
		]
	);

	// A fresh database has no prior upgrade record; clear any stale keys. A
	// current-schema launch must NOT erase the last upgrade shown in Settings.
	if (inspection.kind === 'fresh') {
		await db.execute(`DELETE FROM app_meta WHERE key = 'last_migrated_from_schema'`);
		await db.execute(`DELETE FROM app_meta WHERE key = 'last_upgrade_backup_path'`);
		return;
	}

	if (migratedFrom !== null) {
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_migrated_from_schema', ?)`,
			[String(migratedFrom)]
		);
	}
	if (backup !== null) {
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_upgrade_backup_path', ?)`,
			[backup.path]
		);
	}
}

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

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
	const { runIntegrityCheck: runIntegrityCheckBrowser, checkOrphanedTransfers } = await import('./browser/integrity');
	const { runMigrations } = await import('./browser/migrations/runner');
	const { migrations, LATEST_SCHEMA_VERSION } = await import('./browser/migrations/index');
	const { inspectSchema: inspectSchemaBrowser } = await import('./browser/schema');
	const { createInMemoryDb: createInMemoryDbBrowser } = await import('./browser/in-memory');
	const { BrowserDatabaseClient } = await import('./browser/client');

	const db = await createInMemoryDbBrowser();
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
			await runIntegrityCheckBrowser(db);
			await checkOrphanedTransfers(db);
		},
	};

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
