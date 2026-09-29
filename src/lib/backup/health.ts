import type { MetaOps } from '../db/client';

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

/**
 * Database + backup health for the Settings → Backup card. Reads ONLY these
 * app_meta keys through the domain port — never financial tables:
 * `schema_version`, `last_backup_at`, `last_upgrade_backup_path`,
 * `last_migrated_from_schema`, `backup_warning`.
 */
export async function getBackupHealth(
	meta: MetaOps,
	options: BackupHealthOptions
): Promise<BackupHealth> {
	const [schemaVersion, lastRoutineBackupAt, lastUpgradeBackupPath, lastMigratedFromSchema, warning] =
		await Promise.all([
			meta.get('schema_version'),
			meta.get('last_backup_at'),
			meta.get('last_upgrade_backup_path'),
			meta.get('last_migrated_from_schema'),
			meta.get('backup_warning')
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
