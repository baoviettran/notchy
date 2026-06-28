import type { DatabaseService } from '../db/service';

export interface BackupInfo {
	path: string;
	timestamp: string;
	size: number;
}

/**
 * Auto-backup: VACUUM INTO a timestamped file. Retains the 10 most recent.
 * In Tauri, this uses the filesystem API. For testing, we validate the logic.
 */
export async function createBackup(db: DatabaseService, backupDir: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `notchy-backup-${timestamp}.sqlite`;
	const path = `${backupDir}/${filename}`;

	await db.execute(`VACUUM INTO ?`, [path]);
	return path;
}

/**
 * Run auto-backup on app launch. Best-effort: failures are logged but don't block startup.
 * Skips if last backup was less than 1 hour ago.
 */
export async function runAutoBackup(db: DatabaseService): Promise<void> {
	if (typeof window === 'undefined') return; // Skip in test/SSR
	// Skip in a plain browser (Playwright/dev/preview): backup writes via the
	// Tauri FS plugin, which only exists inside the Tauri webview.
	const isTauri = !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
	if (!isTauri) return;

	try {
		// Skip if last backup was less than 1 hour ago
		const lastBackup = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'last_backup_at'`
		);
		if (lastBackup.length > 0) {
			const lastTime = new Date(lastBackup[0].value).getTime();
			if (Date.now() - lastTime < 3600_000) return;
		}

		const { appDataDir, join } = await import('@tauri-apps/api/path');
		const { mkdir, readDir, remove, stat } = await import('@tauri-apps/plugin-fs');

		const dataDir = await appDataDir();
		const backupDir = await join(dataDir, 'backups');

		await mkdir(backupDir, { recursive: true }).catch(() => {});

		// Take the backup
		await createBackup(db, backupDir);

		// Prune old backups, keep 10 most recent (reuse getBackupsToDelete)
		const entries = await readDir(backupDir).catch(() => []);
		const backupInfos: BackupInfo[] = [];
		for (const entry of entries) {
			if (!entry.name?.startsWith('notchy-backup-')) continue;
			const filePath = await join(backupDir, entry.name);
			const fileSize = await stat(filePath).then((s) => s.size).catch(() => 0);
			// Extract timestamp from filename: notchy-backup-2025-06-02T12-30-00-000Z.sqlite
			const tsMatch = entry.name.match(/^notchy-backup-(.+)\.sqlite$/);
			const timestamp = tsMatch ? tsMatch[1].replace(/-/g, (m, i) =>
				i === 4 || i === 7 ? '-' : i === 10 ? 'T' : m
			) : entry.name;
			backupInfos.push({ path: filePath, timestamp, size: fileSize });
		}

		const toDelete = getBackupsToDelete(backupInfos);
		for (const path of toDelete) {
			await remove(path).catch(() => {});
		}

		// Record backup time in app_meta
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_backup_at', ?)`,
			[new Date().toISOString()]
		);
	} catch (e) {
		console.warn('Auto-backup failed:', e);
		// Set warning so UI can show it
		try {
			await db.execute(
				`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('backup_warning', ?)`,
				[String(e)]
			);
		} catch {}
	}
}

/**
 * Prune old backups, keeping only the most recent `keep` files.
 * Returns the list of paths that should be deleted.
 */
export function getBackupsToDelete(backups: BackupInfo[], keep = 10): string[] {
	if (backups.length <= keep) return [];
	const sorted = [...backups].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
	return sorted.slice(keep).map((b) => b.path);
}

/**
 * Export all tables as CSV. Returns a map of table name → CSV content.
 */
export async function exportCsv(db: DatabaseService): Promise<Map<string, string>> {
	const tables = ['accounts', 'category_types', 'category_tags', 'transactions', 'budgets', 'goals', 'reconciliations'];
	const result = new Map<string, string>();

	for (const table of tables) {
		const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE deleted_at IS NULL`);
		if (rows.length === 0) {
			result.set(table, '');
			continue;
		}
		const headers = Object.keys(rows[0]);
		const lines = [headers.join(',')];
		for (const row of rows) {
			lines.push(headers.map((h) => csvEscape(String(row[h] ?? ''))).join(','));
		}
		result.set(table, lines.join('\n'));
	}
	return result;
}

/**
 * Validate an imported database file before replacing.
 * Checks: integrity_check passes, required tables exist, schema_version matches.
 */
export async function validateImport(importDb: DatabaseService, expectedVersion: number): Promise<{ valid: boolean; error?: string }> {
	// Integrity check
	const integrity = await importDb.query<{ integrity_check: string }>('PRAGMA integrity_check');
	if (integrity[0]?.integrity_check !== 'ok') {
		return { valid: false, error: 'Database file is corrupt' };
	}

	// Schema version check
	const version = await importDb.query<{ value: string }>(
		`SELECT value FROM app_meta WHERE key = 'schema_version'`
	).catch(() => []);

	if (version.length === 0) {
		return { valid: false, error: 'Not a valid Notchy database (missing schema_version)' };
	}

	const importVersion = parseInt(version[0].value, 10);
	if (importVersion !== expectedVersion) {
		return { valid: false, error: `Schema version mismatch: expected ${expectedVersion}, got ${importVersion}` };
	}

	// Required tables check
	const tables = await importDb.query<{ name: string }>(
		`SELECT name FROM sqlite_master WHERE type='table'`
	);
	const tableNames = new Set(tables.map((t) => t.name));
	const required = ['accounts', 'transactions', 'category_types', 'category_tags', 'app_meta'];
	for (const t of required) {
		if (!tableNames.has(t)) {
			return { valid: false, error: `Missing required table: ${t}` };
		}
	}

	return { valid: true };
}

function csvEscape(value: string): string {
	if (value.includes(',') || value.includes('"') || value.includes('\n')) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}
