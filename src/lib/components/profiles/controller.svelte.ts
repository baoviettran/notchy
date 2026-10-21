import type { ProfileRecord } from '$lib/profiles/types';

export type ProfileDialogMode = 'create' | 'rename' | 'backup' | 'restore' | 'restore-success' | 'reset' | 'delete';

class ProfileDialogController {
	mode = $state<ProfileDialogMode | null>(null);
	target = $state<ProfileRecord | null>(null);
	restored = $state<ProfileRecord | null>(null);
	open(mode: ProfileDialogMode, target: ProfileRecord | null = null): void {
		this.target = target;
		this.restored = null;
		this.mode = mode;
	}
	showRestored(record: ProfileRecord): void { this.restored = record; this.mode = 'restore-success'; }
	close(): void { this.mode = null; this.target = null; this.restored = null; }
}

export const profileDialog = new ProfileDialogController();
