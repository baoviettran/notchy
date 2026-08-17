import { isTauri, getDb, initDb, closeDb } from '$lib/db';
import { databaseInitialize, databaseRetry, type DatabaseStatus } from '$lib/db/native/client';
import { invoke } from '@tauri-apps/api/core';
import { LATEST_SCHEMA_VERSION } from '$lib/db/migrations/index';

/**
 * Map a Rust DatabaseStatus to a RecoveryContext compatible with the
 * recovery UI. The Rust side provides typed error codes and metadata.
 */
function statusToRecovery(status: DatabaseStatus): {
	code: string;
	appVersion: string;
	latestSchemaVersion: number;
	detectedSchemaVersion: number | null;
	liveDatabasePath: string;
	backupPath: string | null;
	detail: string;
} | null {
	if (!status.recovery) return null;
	return {
		code: status.recovery.code,
		appVersion: status.recovery.app_version,
		latestSchemaVersion: status.recovery.latest_schema_version,
		detectedSchemaVersion: status.recovery.detected_schema_version,
		liveDatabasePath: status.recovery.live_database_path,
		backupPath: status.recovery.backup_path,
		detail: status.recovery.detail,
	};
}

/**
 * Stopgap for unexpected startup failures (platform-layer errors like path
 * resolution or connection open, which carry no RecoveryContext of their own).
 * Maps to a stable `database_corrupt` recovery so the recovery UI still has
 * something to render.
 */
function fallbackRecovery(error: unknown): {
	code: string;
	appVersion: string;
	latestSchemaVersion: number;
	detectedSchemaVersion: number | null;
	liveDatabasePath: string;
	backupPath: string | null;
	detail: string;
} {
	return {
		code: 'database_corrupt',
		appVersion: 'unknown',
		latestSchemaVersion: LATEST_SCHEMA_VERSION,
		detectedSchemaVersion: null,
		liveDatabasePath: 'unknown',
		backupPath: null,
		detail: String(error)
	};
}

type StartupStage = 'checking' | 'backing_up' | 'migrating' | 'verifying' | 'ready' | 'recovery_required';

class DbStore {
	stage = $state<StartupStage>('checking');
	ready = $derived(this.stage === 'ready');
	firstRunComplete = $state(false);
	recovery = $state<{
		code: string;
		appVersion: string;
		latestSchemaVersion: number;
		detectedSchemaVersion: number | null;
		liveDatabasePath: string;
		backupPath: string | null;
		detail: string;
	} | null>(null);

	async init(): Promise<void> {
		this.recovery = null;

		if (isTauri()) {
			// Tauri: delegate lifecycle to Rust via database_initialize.
			try {
				const status = await databaseInitialize();
				this.mapStatus(status);
			} catch (error) {
				this.stage = 'recovery_required';
				this.recovery = fallbackRecovery(error);
			}
			return;
		}

		// Browser fallback: sql.js in-memory with JS startup pipeline.
		try {
			await initDb((stage) => {
				this.stage = stage as StartupStage;
			});
			this.stage = 'ready';

			// E2E test hook: expose db + backup entry points on window so Playwright
			// page.evaluate can drive the REAL createBackup/restoreCompatibleDatabase
			// against the Tauri IPC mock. Gated on the e2e mock marker OR the absence
			// of Tauri (in-memory fallback path). Real Tauri (production) never
			// defines __NOTCHY_TAURI_MOCK_OPTIONS__ and always has __TAURI_INTERNALS__,
			// so this branch is dead code in shipped builds and carries no surface/risk.
			if (typeof window !== 'undefined') {
				const hasMockMarker = (window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: unknown }).__NOTCHY_TAURI_MOCK_OPTIONS__ !== undefined;
				const hasTauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

				if (hasMockMarker || !hasTauri) {
					const backup = await import('$lib/backup');
					const { restoreCompatibleDatabase } = await import('$lib/recovery');
					const { getDb: getDbFn } = await import('$lib/db');
					(window as unknown as { __notchyTestHooks?: Record<string, unknown> }).__notchyTestHooks = {
						getDb: getDbFn,
						createBackup: backup.createBackup,
						restoreCompatibleDatabase
					};
				}
			}
		} catch (error) {
			this.stage = 'recovery_required';
			this.recovery = fallbackRecovery(error);
		}
	}

	/**
	 * Map a Rust DatabaseStatus to store state. Extracts the lifecycle
	 * stage from the tagged-union `current` field.
	 */
	private mapStatus(status: DatabaseStatus): void {
		if (status.recovery) {
			this.stage = 'recovery_required';
			this.recovery = statusToRecovery(status);
			return;
		}

		if (status.current) {
			const current = status.current;
			if ('checking' in current) this.stage = 'checking';
			else if ('backing_up' in current) this.stage = 'backing_up';
			else if ('migrating' in current) this.stage = 'migrating';
			else if ('verifying' in current) this.stage = 'verifying';
			else if ('ready' in current) {
				this.stage = 'ready';
				void this.onReady();
				return;
			}
		}
	}

	/**
	 * Called once when the database reaches 'ready' state.
	 * Loads first-run metadata and E2E test hooks.
	 */
	private async onReady(): Promise<void> {
		try {
			const db = getDb();
			this.firstRunComplete = await db.meta.isFirstRunComplete();
		} catch {
			// Non-fatal: firstRunComplete defaults to false.
		}

		// E2E test hook (same logic as browser path).
		if (typeof window !== 'undefined') {
			const hasMockMarker = (window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: unknown }).__NOTCHY_TAURI_MOCK_OPTIONS__ !== undefined;
			const hasTauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

			if (hasMockMarker || !hasTauri) {
				const backup = await import('$lib/backup');
				const { restoreCompatibleDatabase } = await import('$lib/recovery');
				const { getDb: getDbFn } = await import('$lib/db');
				(window as unknown as { __notchyTestHooks?: Record<string, unknown> }).__notchyTestHooks = {
					getDb: getDbFn,
					createBackup: backup.createBackup,
					restoreCompatibleDatabase
				};
			}
		}
	}

	async retry(): Promise<void> {
		if (isTauri()) {
			try {
				const status = await databaseRetry();
				this.mapStatus(status);
			} catch (error) {
				this.stage = 'recovery_required';
				this.recovery = fallbackRecovery(error);
			}
		} else {
			await closeDb();
			await this.init();
		}
	}

	async restoreLatestBackup(): Promise<void> {
		if (!this.recovery?.backupPath) return;
		const { restoreCompatibleDatabase } = await import('$lib/recovery');
		await restoreCompatibleDatabase(this.recovery.backupPath);
		globalThis.location.reload();
	}

	async openBackupFolder(): Promise<void> {
		const { getDatabasePaths, openBackupFolder } = await import('$lib/db');
		const { upgradeBackupDir } = await getDatabasePaths();
		await openBackupFolder(upgradeBackupDir);
	}

	async quit(): Promise<void> {
		if (isTauri()) await invoke('quit_app');
	}
}

export const dbStore = new DbStore();
