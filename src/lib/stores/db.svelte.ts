import { getDb } from '$lib/db';
import * as meta from '$lib/db/repos/meta';

class DbStore {
	ready = $state(false);
	firstRunComplete = $state(false);
	error = $state<string | null>(null);

	async init(): Promise<void> {
		try {
			const db = await getDb();
			this.firstRunComplete = await meta.isFirstRunComplete(db);
			this.ready = true;
		} catch (e) {
			this.error = String(e);
		}
	}
}

export const dbStore = new DbStore();
