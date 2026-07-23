import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';
import { runAutoBackup } from '$lib/backup';
import { mapError } from '$lib/utils/errors';

class DbStore {
	ready = $state(false);
	firstRunComplete = $state(false);
	error = $state<string | null>(null);

	async init(): Promise<void> {
		try {
			const db = await getDb();
			this.firstRunComplete = await meta.isFirstRunComplete(db);
			this.ready = true;
			// Run auto-backup in the background, don't block startup
			runAutoBackup(db).catch((e) => console.warn('Auto-backup error:', e));

			// E2E test hook: expose db + backup entry points on window so Playwright
			// page.evaluate can drive the REAL createBackup/importDatabase against
			// the Tauri IPC mock. Gated on the e2e mock marker OR the absence of
			// Tauri (in-memory fallback path). Real Tauri (production) never defines
			// __NOTCHY_TAURI_MOCK_OPTIONS__ and always has __TAURI_INTERNALS__, so
			// this branch is dead code in shipped builds and carries no surface/risk.
			if (typeof window !== 'undefined') {
				const hasMockMarker = (window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: unknown }).__NOTCHY_TAURI_MOCK_OPTIONS__ !== undefined;
				const hasTauri = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;

				if (hasMockMarker || !hasTauri) {
					const backup = await import('$lib/backup');
					(window as unknown as { __notchyTestHooks?: Record<string, unknown> }).__notchyTestHooks = {
						getDb,
						createBackup: backup.createBackup,
						importDatabase: backup.importDatabase
					};
				}
			}
		} catch (e) {
			this.error = mapError(e);
		}
	}
}

export const dbStore = new DbStore();
