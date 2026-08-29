/**
 * Pure database-boot decision logic, extracted from stores/db.svelte.ts.
 *
 * These functions map a Rust `DatabaseStatus` (or an unexpected platform
 * error) into the shape the recovery UI renders. They touch no `$state`,
 * no Tauri wiring, and no window — so Istanbul can measure branch coverage
 * and Tasks 8/9 can regression-test them directly.
 *
 * The store keeps all the `$state` mutation and `isTauri()`/event plumbing;
 * it calls into these for the pure decisions only.
 */
import { LATEST_SCHEMA_VERSION } from '$lib/db/migrations/index';
import type { DatabaseStatus, BackupSummary } from '$lib/db/native/client';

export type StartupStage =
	| 'checking'
	| 'backing_up'
	| 'migrating'
	| 'verifying'
	| 'ready'
	| 'recovery_required';

/**
 * Full recovery info shape expected by the RecoveryScreen UI.
 * The Rust RecoveryContext only provides `code` and `retryable`; the
 * remaining fields are populated from defaults or the backup list.
 */
export interface RecoveryInfo {
	code: string;
	appVersion: string;
	latestSchemaVersion: number;
	detectedSchemaVersion: number | null;
	liveDatabasePath: string;
	backupPath: string | null;
	detail: string;
}

/**
 * Map the `status.stage` sub-field to the frontend StartupStage — but ONLY
 * for the four known in-flight stages. Returns `null` for anything else so
 * the caller leaves its current stage unchanged (exactly what the store's
 * original if/else chain did: an unknown stage assigned nothing).
 *
 * Note this intentionally reads only `status.stage`; the caller decides
 * whether `ready` / `recovery_required` win via its own ordering.
 */
export function startupStageFromStatus(
	status: DatabaseStatus
): Extract<StartupStage, 'checking' | 'backing_up' | 'migrating' | 'verifying'> | null {
	const stage = status.stage;
	if (stage === 'checking') return 'checking';
	if (stage === 'backing_up') return 'backing_up';
	if (stage === 'migrating') return 'migrating';
	if (stage === 'verifying') return 'verifying';
	return null;
}

/**
 * Map a Rust DatabaseStatus to a RecoveryInfo compatible with the recovery
 * UI. The Rust side provides typed error codes; the remaining fields are
 * filled with safe defaults.
 */
export function statusToRecovery(
	status: DatabaseStatus,
	backups: BackupSummary[]
): RecoveryInfo | null {
	if (!status.recovery) return null;
	const latestBackup = backups[0];
	return {
		code: status.recovery.code,
		appVersion: 'unknown',
		latestSchemaVersion: LATEST_SCHEMA_VERSION,
		detectedSchemaVersion: null,
		liveDatabasePath: 'unknown',
		backupPath: latestBackup?.path ?? null,
		detail: '',
	};
}

/**
 * Stopgap for unexpected startup failures (platform-layer errors like path
 * resolution or connection open, which carry no RecoveryContext of their own).
 * Maps to a stable `database_corrupt` recovery so the recovery UI still has
 * something to render.
 */
export function fallbackRecovery(error: unknown): RecoveryInfo {
	return {
		code: 'database_corrupt',
		appVersion: 'unknown',
		latestSchemaVersion: LATEST_SCHEMA_VERSION,
		detectedSchemaVersion: null,
		liveDatabasePath: 'unknown',
		backupPath: null,
		detail: String(error),
	};
}