import { closeDb, getDb, initializeDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import { runAutoBackup } from '$lib/backup';
import { DatabaseStartupError, type RecoveryContext, type StartupStage } from '$lib/db/startup';
import { LATEST_SCHEMA_VERSION } from '$lib/db/migrations/index';

/**
 * Stopgap for unexpected startup failures (platform-layer errors like path
 * resolution or connection open, which carry no RecoveryContext of their own).
 * Maps to a stable `database_corrupt` recovery so the recovery UI still has
 * something to render.
 */
function fallbackRecovery(error: unknown): RecoveryContext {
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

class DbStore {
	stage = $state<StartupStage>('checking');
	ready = $derived(this.stage === 'ready');
	firstRunComplete = $state(false);
	recovery = $state<RecoveryContext | null>(null);

	async init(): Promise<void> {
		this.recovery = null;
		try {
			await initializeDb((stage) => {
				this.stage = stage;
			});
			const db = await getDb();
			this.firstRunComplete = await meta.isFirstRunComplete(db);
			this.stage = 'ready';
			// Run auto-backup in the background, don't block startup
			void runAutoBackup(db);

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
					(window as unknown as { __notchyTestHooks?: Record<string, unknown> }).__notchyTestHooks = {
						getDb,
						createBackup: backup.createBackup,
						restoreCompatibleDatabase
					};
				}
			}
		} catch (error) {
			this.stage = 'recovery_required';
			this.recovery = error instanceof DatabaseStartupError ? error.recovery : fallbackRecovery(error);
		}
	}

	async retry(): Promise<void> {
		await closeDb();
		await this.init();
	}
}

export const dbStore = new DbStore();
