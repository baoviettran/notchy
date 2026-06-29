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
		} catch (e) {
			this.error = mapError(e);
		}
	}
}

export const dbStore = new DbStore();
