import type { DatabaseService } from './browser/service';
import { createTauriDb } from './browser/service';
import { createInMemoryDb } from './browser/in-memory';
import type { UpgradeBackupRecord } from '$lib/backup/upgrade';
import { parseUpgradeBackupName } from '$lib/backup/upgrade';

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
