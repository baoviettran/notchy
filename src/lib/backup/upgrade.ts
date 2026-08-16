import { mkdir } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DatabaseService } from '$lib/db/service';
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
	await mkdir(options.backupDir, { recursive: true });
	await db.execute(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

	const backupDb = await options.openReadOnly(backupPath);
	try {
		const validation = await validateDatabase(backupDb, { exact: options.sourceSchema });
		if (!validation.valid) {
			throw new AppError('upgrade_backup_verification_failed', { code: validation.code });
		}
	} finally {
		await backupDb.close();
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
	const match = basename(filePath).match(UPGRADE_BACKUP_NAME);
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
