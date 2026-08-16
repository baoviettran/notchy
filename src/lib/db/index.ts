import type { DatabaseService } from './service';
import { applyPragmas } from './pragmas';
import { runIntegrityCheck, checkOrphanedTransfers } from './integrity';
import { runMigrations } from './migrations/runner';
import { migrations, LATEST_SCHEMA_VERSION } from './migrations/index';
import { inspectSchema } from './schema';
import { prepareDatabase, type StartupDependencies, type StartupStage, type StartupSuccess } from './startup';
import { AppError } from '$lib/errors';
import { createVerifiedUpgradeBackup, getUpgradeBackupsToDelete } from '$lib/backup/upgrade';
import {
	ensureDirectory,
	getDatabasePaths,
	getInstalledAppVersion,
	isTauri,
	listUpgradeBackupRecords,
	openConnection,
	openReadOnlyDatabase,
	removeFile
} from './platform';

export { isTauri };

let _db: DatabaseService | null = null;
let initialization: Promise<StartupSuccess> | null = null;

/**
 * Run the protected startup pipeline exactly once per JS context. Concurrent
 * callers share the same promise (coalesced); on rejection the connection is
 * closed and the promise cleared so a later retry can start fresh.
 */
export function initializeDb(onStage: (stage: StartupStage) => void = () => {}): Promise<StartupSuccess> {
	if (initialization) return initialization;
	initialization = initializeMainDatabase(onStage).catch(async (error) => {
		await closeDb();
		initialization = null;
		throw error;
	});
	return initialization;
}

/**
 * Finance repositories always call this. Main window: returns the cached
 * initialized connection. Plain browser: initializes first (in-memory sql.js).
 * Tauri non-main window (quick-add): opens the already-migrated shared pool via
 * `openCurrentDb`, which rejects with `database_update_required` while the main
 * window is still migrating an older schema — never migrates from here.
 */
export async function getDb(): Promise<DatabaseService> {
	if (_db) return _db;
	if (!isTauri()) {
		await initializeDb();
		return _db!;
	}
	return openCurrentDb();
}

/**
 * Open the live connection, apply pragmas, and return it only when the schema
 * is current. For older/newer/invalid schemas the connection is closed and an
 * `AppError('database_update_required')` is thrown — this path never migrates
 * and never modifies anything. Used by non-main Tauri windows to access the
 * pooled connection the main window already migrated.
 */
export async function openCurrentDb(): Promise<DatabaseService> {
	const connection = await openConnection();
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		await connection.close();
	};
	try {
		await applyPragmas(connection);
		const inspection = await inspectSchema(connection, LATEST_SCHEMA_VERSION);
		if (inspection.kind !== 'current') {
			await close();
			throw new AppError('database_update_required');
		}
		return connection;
	} catch (error) {
		await close().catch(() => {});
		throw error;
	}
}

/**
 * Main-window-only startup. Opens the live connection, caches it, and runs
 * `prepareDatabase` with real platform dependencies: mandatory pre-upgrade
 * backup (pruned only after a verified new backup exists), migration, and
 * post-migration integrity + orphan verification.
 */
async function initializeMainDatabase(onStage: (stage: StartupStage) => void): Promise<StartupSuccess> {
	const [paths, appVersion] = await Promise.all([getDatabasePaths(), getInstalledAppVersion()]);
	const db = await openConnection();
	_db = db;
	await applyPragmas(db);

	const dependencies: StartupDependencies = {
		latestSchemaVersion: LATEST_SCHEMA_VERSION,
		appVersion,
		liveDatabasePath: paths.databasePath,
		now: () => new Date(),
		createUpgradeBackup: async (sourceSchema) => {
			await ensureDirectory(paths.upgradeBackupDir);
			const record = await createVerifiedUpgradeBackup(db, {
				backupDir: paths.upgradeBackupDir,
				sourceSchema,
				targetSchema: LATEST_SCHEMA_VERSION,
				sourceAppVersion: appVersion,
				createdAt: new Date(),
				ensureDirectory,
				openReadOnly: openReadOnlyDatabase
			});
			// Only prune after the verified record exists: the just-created backup
			// is the newest, so it survives the retention cut.
			const records = await listUpgradeBackupRecords(paths.upgradeBackupDir);
			for (const path of getUpgradeBackupsToDelete(records)) {
				await removeFile(path);
			}
			return record;
		},
		runMigrations: () => runMigrations(db, migrations),
		verifyAfterMigration: async () => {
			await runIntegrityCheck(db);
			await checkOrphanedTransfers(db);
		}
	};

	return prepareDatabase(db, dependencies, onStage);
}

export async function closeDb(): Promise<void> {
	if (_db) {
		await _db.close();
		_db = null;
	}
}
