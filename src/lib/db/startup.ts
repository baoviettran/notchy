import type { UpgradeBackupRecord } from '$lib/backup/upgrade';
import { runIntegrityCheck } from './integrity';
import { inspectSchema, type SchemaInspection } from './schema';
import type { DatabaseService } from './service';

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
