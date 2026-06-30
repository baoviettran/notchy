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
	// VACUUM INTO does not accept a bound parameter for the filename — it must be
	// a string literal. Inline an escaped literal (SQL doubles single-quotes).
	await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
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

/**
 * Import a database file: validate it in a read-only connection, and only on
 * success copy it over the live `notchy.db`. The caller must close the live DB
 * connection and reload after this resolves. Never touches the live DB on
 * validation failure. Throws on any error (caller surfaces the message).
 */
export async function importDatabase(
	sourcePath: string,
	expectedVersion: number
): Promise<{ valid: boolean; error?: string }> {
	const { createTauriDb } = await import('../db/service');
	const { closeDb } = await import('../db');

	// Open the candidate file READ-ONLY. The Tauri SQL plugin (sqlite variant)
	// honors `?readonly` on the connection string, preventing any write to the
	// source during validation.
	let importDb;
	try {
		importDb = await createTauriDb(`sqlite:${sourcePath}?readonly`);
	} catch {
		// Fallback: some plugin builds don't parse ?readonly; open without it —
		// validateImport only reads, so the source is still untouched.
		importDb = await createTauriDb(`sqlite:${sourcePath}`);
	}

	try {
		const validation = await validateImport(importDb, expectedVersion);
		if (!validation.valid) return validation;

		// Validated: replace the live DB. Resolve the live path and copy the
		// source over it, then close the live connection so the next getDb()
		// reopens the replaced file.
		const { appDataDir, join } = await import('@tauri-apps/api/path');
		const { copyFile } = await import('@tauri-apps/plugin-fs');
		const dataDir = await appDataDir();
		const livePath = await join(dataDir, 'notchy.db');
		await closeDb();
		await copyFile(sourcePath, livePath);
		return { valid: true };
	} finally {
		await importDb.close();
	}
}

function csvEscape(value: string): string {
	// CSV formula injection: a value beginning with = + - @ or TAB/CR is
	// interpreted as a formula by Excel/LibreOffice (e.g. =HYPERLINK to
	// exfiltrate other cells). Prefix with a single quote — spreadsheets render
	// it as text and hide the leading quote. Neutralize BEFORE quoting.
	let escaped = value;
	if (/^[=+\-@\t\r]/.test(escaped)) {
		escaped = `'${escaped}`;
	}
	if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
		return `"${escaped.replace(/"/g, '""')}"`;
	}
	return escaped;
}
