import type { DatabaseService } from './service';
import { createTauriDb } from './service';
import { createInMemoryDb } from './in-memory';
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
 * Resolve the app-data directory and the paths derived from it. In a plain
 * browser (web build / E2E without Tauri) these are synthetic — never call the
 * Tauri path plugin — so startup can still report a stable live path.
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
	const { appDataDir, join } = await import('@tauri-apps/api/path');
	const dataDir = await appDataDir();
	return {
		dataDir,
		databasePath: await join(dataDir, 'notchy.db'),
		routineBackupDir: await join(dataDir, 'backups'),
		upgradeBackupDir: await join(dataDir, 'backups', 'upgrades')
	};
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
	return createTauriDb(`sqlite:${path}?readonly`);
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
