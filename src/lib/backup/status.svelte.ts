import type { AutomaticBackupStatus } from '$lib/db/client';
import type { ProfileSession } from '$lib/profiles/types';
export function sameBackupSession(a: ProfileSession | null, b: ProfileSession | null): boolean {
	return !!a && !!b && a.profileId === b.profileId && a.generation === b.generation;
}
export const automaticBackupState = new class {
	session = $state<ProfileSession | null>(null);
	status = $state<AutomaticBackupStatus | null>(null);
	error = $state(false);
	reset(session: ProfileSession | null): void {
		this.session = session ? { ...session } : null; this.status = null; this.error = false;
	}
	publish(session: ProfileSession, status: AutomaticBackupStatus): void {
		if (!sameBackupSession(session, this.session)) return;
		this.status = status; this.error = false;
	}
	fail(session: ProfileSession): void {
		if (sameBackupSession(session, this.session)) this.error = true;
	}
}();
