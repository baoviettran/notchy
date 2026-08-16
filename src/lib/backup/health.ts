import type { DatabaseService } from '../db/service';
import { getMeta, setMeta } from '../db/repos/meta';
import { createBackup } from './index';
import { getDatabasePaths, ensureDirectory } from '../db/platform';

export interface BackupHealth {
	appVersion: string;
	schemaVersion: number;
	databasePath: string;
	lastRoutineBackupAt: string | null;
	lastUpgradeBackupPath: string | null;
	lastUpgradeFromSchema: number | null;
	warning: string | null;
}

export interface BackupHealthOptions {
	appVersion: string;
	databasePath: string;
	upgradeBackupDir: string;
}

export interface ManualBackupOptions {
	/** Routine backup directory. Defaults to `getDatabasePaths().routineBackupDir` (Tauri). */
	backupDir?: string;
	/**
	 * Directory-creation seam so the Tauri FS plugin is not required in unit
	 * tests. Defaults to the platform `ensureDirectory`.
	 */
	ensureDirectory?: (path: string) => Promise<void>;
}

/**
 * Database + backup health for the Settings → Backup card. Reads ONLY these
 * app_meta keys — never financial tables:
 * `schema_version`, `last_backup_at`, `last_upgrade_backup_path`,
 * `last_migrated_from_schema`, `backup_warning`.
 */
export async function getBackupHealth(
	db: DatabaseService,
	options: BackupHealthOptions
): Promise<BackupHealth> {
	const [schemaVersion, lastRoutineBackupAt, lastUpgradeBackupPath, lastMigratedFromSchema, warning] =
		await Promise.all([
			getMeta(db, 'schema_version'),
			getMeta(db, 'last_backup_at'),
			getMeta(db, 'last_upgrade_backup_path'),
			getMeta(db, 'last_migrated_from_schema'),
			getMeta(db, 'backup_warning')
		]);

	return {
		appVersion: options.appVersion,
		schemaVersion: parseSchemaVersion(schemaVersion),
		databasePath: options.databasePath,
		lastRoutineBackupAt,
		lastUpgradeBackupPath,
		lastUpgradeFromSchema: lastMigratedFromSchema === null ? null : Number(lastMigratedFromSchema),
		warning
	};
}

/**
 * A missing or non-numeric `schema_version` reads as 0 so the health card
 * renders a stable value instead of NaN.
 */
function parseSchemaVersion(raw: string | null): number {
	if (raw === null) return 0;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Create a manual routine backup and record it. `last_backup_at` is written
 * ONLY after `createBackup` succeeds, so a failed backup leaves the last
 * known-good timestamp intact.
 */
export async function createManualBackup(
	db: DatabaseService,
	options: ManualBackupOptions = {}
): Promise<string> {
	const backupDir = options.backupDir ?? (await getDatabasePaths()).routineBackupDir;
	const ensure = options.ensureDirectory ?? ensureDirectory;
	await ensure(backupDir);
	const path = await createBackup(db, backupDir);
	await setMeta(db, 'last_backup_at', new Date().toISOString());
	return path;
}
