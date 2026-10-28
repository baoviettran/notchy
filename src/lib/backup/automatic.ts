import type { AppDatabase } from '$lib/db/client';
import type { ProfileSession } from '$lib/profiles/types';
import { automaticBackupState, sameBackupSession } from './status.svelte';

/** Each webview uses its bound adapter; native job identity deduplicates windows. */
export function startAutomaticBackupChecks(db: AppDatabase, current: () => ProfileSession | null): () => void {
	const active = current();
	if (!active || typeof window === 'undefined') return () => {};
	const bound = Object.freeze({ ...active });
	if (!sameBackupSession(bound, automaticBackupState.session)) automaticBackupState.reset(bound);
	let stopped = false;
	let checking = false;
	const live = () => !stopped && sameBackupSession(bound, current());
	async function check(): Promise<void> {
		if (!live() || checking) return;
		checking = true;
		try {
			const status = await db.backup.checkAutomatic();
			if (live()) automaticBackupState.publish(bound, status);
		} catch {
			if (live()) automaticBackupState.fail(bound);
		} finally { checking = false; }
	}
	const restored = () => { if (document.visibilityState !== 'hidden') void check(); };
	const timer = window.setInterval(() => { void check(); }, 60_000);
	window.addEventListener('focus', restored);
	document.addEventListener('visibilitychange', restored);
	void check();
	return () => {
		stopped = true; window.clearInterval(timer);
		window.removeEventListener('focus', restored);
		document.removeEventListener('visibilitychange', restored);
	};
}
