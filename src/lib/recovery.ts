import type { DatabaseService, RecoveryContext } from '$lib/db';
import { validateDatabase, type DatabaseValidation } from '$lib/backup/validation';
import { MIN_SUPPORTED_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } from '$lib/db/migrations/index';
import { AppError } from '$lib/errors';

export interface RestoreDependencies {
	openReadOnly(path: string): Promise<DatabaseService>;
	replaceLiveDatabase(sourcePath: string): Promise<void>;
}

/**
 * Native imports use Rust's validated snapshot and crash-safe restore protocol.
 * Browser tests can inject the legacy validation/copy adapter to exercise their
 * real SQLite fixtures without a Tauri host.
 */
export async function restoreCompatibleDatabase(
	sourcePath: string,
	dependencies?: RestoreDependencies
): Promise<{ schemaVersion: number }> {
	if (!dependencies) throw new Error('restore requires the profile service');
	const candidate = await dependencies.openReadOnly(sourcePath);
	let validation: DatabaseValidation;
	try {
		validation = await validateDatabase(candidate, {
			min: MIN_SUPPORTED_SCHEMA_VERSION,
			max: LATEST_SCHEMA_VERSION
		});
	} finally {
		// The candidate connection is intentionally NOT closed. tauri-plugin-sql's
		// `close` hangs on this sqlx version while holding the plugin's pooled-
		// connection lock, which can deadlock later loads (and thus the reload
		// after restore). The candidate is only read during validation, so the
		// copy below is not racing writes; the pool entry is a bounded leak.
	}
	if (!validation.valid) {
		// validateDatabase was called with a range policy; the exact-only
		// `schema_mismatch` code cannot occur, so narrow to the reachable set.
		throw restoreError(validation as RestoreFailure);
	}
	await dependencies.replaceLiveDatabase(sourcePath);
	return { schemaVersion: validation.schemaVersion };
}

/** Failure codes a range-policy restore can actually receive. */
type RestoreFailure = Extract<DatabaseValidation, { valid: false }> & {
	code: 'corrupt' | 'missing_schema_version' | 'schema_too_old' | 'schema_newer' | 'missing_table';
};

function restoreError(validation: RestoreFailure): AppError {
	switch (validation.code) {
		case 'corrupt':
			return new AppError('backup_corrupt');
		case 'missing_schema_version':
			return new AppError('backup_missing_schema_version');
		case 'schema_too_old':
			return new AppError('backup_schema_too_old');
		case 'schema_newer':
			return new AppError('backup_schema_newer');
		case 'missing_table':
			return new AppError('backup_missing_table');
	}
}

/**
 * Allowlisted technical report. Only the stable, non-financial recovery facts
 * are serialized; `context.detail` (which may embed SQL parameters or queried
 * rows) is never copied into a report.
 */
export function buildTechnicalReport(context: RecoveryContext): string {
	return JSON.stringify({
		code: context.code,
		appVersion: context.appVersion,
		latestSchemaVersion: context.latestSchemaVersion,
		detectedSchemaVersion: context.detectedSchemaVersion,
		liveDatabasePath: context.liveDatabasePath,
		backupPath: context.backupPath
	}, null, 2);
}
