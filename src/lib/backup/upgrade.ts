import type { DatabaseService } from '$lib/db';
import { AppError } from '$lib/errors';
import { validateDatabase } from './validation';

export interface UpgradeBackupRecord {
	path: string;
	createdAt: string;
	sourceSchema: number;
	targetSchema: number;
	sourceAppVersion: string;
	verified: true;
}

export interface CreateUpgradeBackupOptions {
	backupDir: string;
	sourceSchema: number;
	targetSchema: number;
	sourceAppVersion: string;
	createdAt: Date;
	ensureDirectory(path: string): Promise<void>;
	openReadOnly(path: string): Promise<DatabaseService>;
}

export interface ParsedUpgradeBackupName {
	sourceSchema: number;
	targetSchema: number;
	sourceAppVersion: string;
	createdAt: string;
}

const UPGRADE_BACKUP_NAME = /^notchy-pre-upgrade-v(\d+)-to-v(\d+)-([0-9A-Za-z._-]+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sqlite$/;

export async function createVerifiedUpgradeBackup(
	db: DatabaseService,
	options: CreateUpgradeBackupOptions
): Promise<UpgradeBackupRecord> {
	const stamp = options.createdAt.toISOString().replace(/[:.]/g, '-');
	const safeVersion = options.sourceAppVersion.replace(/[^0-9A-Za-z.-]/g, '_');
	const filename = `notchy-pre-upgrade-v${options.sourceSchema}-to-v${options.targetSchema}-${safeVersion}-${stamp}.sqlite`;
	const backupPath = `${options.backupDir}/${filename}`;
	await options.ensureDirectory(options.backupDir);
	await db.execute(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

	const backupDb = await options.openReadOnly(backupPath);
	try {
		const validation = await validateDatabase(backupDb, { exact: options.sourceSchema });
		if (!validation.valid) {
			throw new AppError('upgrade_backup_verification_failed', { code: validation.code });
		}
	} finally {
		// The backup connection is intentionally NOT closed. tauri-plugin-sql's
		// `close` hangs on this sqlx version: the command never resolves while
		// holding the plugin's pooled-connection lock, and a pending load (the
		// quick-add window's) then queues behind it, blocking every subsequent
		// query — including the migration. Leaving the pool open is a bounded
		// one-entry leak per upgrade; the backup is only ever read here.
	}

	return {
		path: backupPath,
		createdAt: options.createdAt.toISOString(),
		sourceSchema: options.sourceSchema,
		targetSchema: options.targetSchema,
		sourceAppVersion: options.sourceAppVersion,
		verified: true
	};
}

export function parseUpgradeBackupName(filePath: string): ParsedUpgradeBackupName | null {
	const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
	const match = filePath.slice(separator + 1).match(UPGRADE_BACKUP_NAME);
	if (!match) return null;
	const [, sourceSchema, targetSchema, sourceAppVersion, stamp] = match;
	return {
		sourceSchema: Number(sourceSchema),
		targetSchema: Number(targetSchema),
		sourceAppVersion,
		createdAt: `${stamp.slice(0, 13)}:${stamp.slice(14, 16)}:${stamp.slice(17, 19)}.${stamp.slice(20)}`
	};
}

export function getUpgradeBackupsToDelete(
	records: UpgradeBackupRecord[],
	keepPerSource = 2
): string[] {
	const bySource = new Map<number, UpgradeBackupRecord[]>();
	for (const record of records) {
		bySource.set(record.sourceSchema, [...(bySource.get(record.sourceSchema) ?? []), record]);
	}

	return [...bySource.values()].flatMap((group) =>
		[...group]
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(keepPerSource)
			.map((record) => record.path)
	);
}
