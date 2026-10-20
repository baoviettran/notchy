import type { ProfileSession } from '$lib/profiles/types';
import type { StartupStage } from '$lib/logic/db-boot';

/** UI readiness follows the profile coordinator's bound session. */
class DbStore {
	stage = $state<StartupStage>('checking');
	ready = $derived(this.stage === 'ready');
	firstRunComplete = $state(false);

	resetForProfile(session: ProfileSession | null): void {
		this.stage = session ? 'ready' : 'checking';
		this.firstRunComplete = false;
	}
}

export const dbStore = new DbStore();
