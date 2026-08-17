/**
 * Crash-safe recovery bridge (Task 15).
 *
 * Under Tauri: delegates to the native `discover_restore_points` and
 * `database_restore` commands which implement the crash-safe restore protocol.
 *
 * Under browser (Vitest / Playwright): returns stub data. The JS fallback
 * recovery path in `$lib/recovery.ts` handles browser/test restores.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/db';
import type { BackupSummary } from './client';

export type { BackupSummary } from './client';

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
 * Under Tauri: calls the native `discover_restore_points` command which
 * scans the backup directory and returns verified backup records.
 *
 * Under browser: returns an empty list (browser/test fallback).
 */
export async function discoverRestorePoints(_backupDir: string): Promise<BackupSummary[]> {
	if (!isTauri()) return [];
	return invoke<BackupSummary[]>('discover_restore_points');
}

/**
 * Replace the live database with a verified backup.
 *
 * Under Tauri: calls the native `database_restore` command which performs
 * the full crash-safe restore protocol (rollback, validate, copy, fsync,
 * rename, reopen, migrate, validate).
 *
 * Under browser: throws (browser/test fallback uses `$lib/recovery.ts`).
 */
export async function restoreDatabase(
	summary: BackupSummary,
	_failpoint: RestoreFailurePoint = 'none'
): Promise<void> {
	if (!isTauri()) {
		throw new Error('restoreDatabase: native bridge not available in browser');
	}
	await invoke('database_restore', { summary });
}
