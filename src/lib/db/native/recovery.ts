/**
 * Crash-safe recovery discovery (Task 12 stub).
 *
 * This module will expose TypeScript bindings for the native restore protocol:
 * - `discoverRestorePoints`: list verified backups available for restore
 * - `restoreDatabase`: replace the live database with a verified backup
 * - `RestoreFailurePoint`: fault-injection enum for integration tests
 *
 * The actual Tauri command bindings will be generated from the Rust types
 * in `src-tauri/src/database/restore.rs` once Task 7 regenerates the
 * TypeScript contract bindings.
 */

export interface BackupSummary {
	id: string;
	path: string;
	schema_version: number;
	source_app_version: string;
	created_at: string;
	verified: boolean;
}

export type RestoreFailurePoint =
	| 'none'
	| 'after_rollback'
	| 'after_restore_copy'
	| 'after_restore_file_sync'
	| 'after_close_connection'
	| 'after_retire_journals'
	| 'after_rename'
	| 'after_dir_sync';

/**
 * Discover all verified backups available for restore, newest first.
 *
 * Stub: will call the native `discover_restore_points` command once
 * the Tauri IPC bridge is wired up.
 */
export async function discoverRestorePoints(_backupDir: string): Promise<BackupSummary[]> {
	// TODO: invoke native command when Tauri IPC bridge is ready.
	return [];
}

/**
 * Replace the live database with a verified backup.
 *
 * Stub: will call the native `restore_database` command once
 * the Tauri IPC bridge is wired up.
 */
export async function restoreDatabase(
	_token: string,
	_failpoint: RestoreFailurePoint = 'none'
): Promise<void> {
	// TODO: invoke native command when Tauri IPC bridge is ready.
	throw new Error('restoreDatabase: native bridge not yet wired');
}
