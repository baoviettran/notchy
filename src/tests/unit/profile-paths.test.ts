// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ id: null as string | null, invoke: vi.fn() }));
vi.mock('$lib/profiles/current', () => ({ getBoundProfileSession: () => state.id ? { profileId: state.id, generation: 'g1' } : null, setBoundProfileSession: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }));

import { getDatabasePaths } from '$lib/db';

beforeEach(() => {
	state.id = null;
	state.invoke.mockReset();
	(window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

describe('profile database paths', () => {
	it('rejects native path requests before a profile is selected', async () => {
		await expect(getDatabasePaths()).rejects.toThrow(/profile/i);
		expect(state.invoke).not.toHaveBeenCalled();
	});
	it('asks Rust for the selected profile directory', async () => {
		state.id = 'profile-A';
		state.invoke.mockResolvedValue({ dataDir: '/data/profiles/profile-A', databasePath: '/data/profiles/profile-A/notchy.db', routineBackupDir: '/data/profiles/profile-A/backups', upgradeBackupDir: '/data/profiles/profile-A/backups/upgrades', resetBackupDir: '/data/profiles/profile-A/backups/resets' });
		const paths = await getDatabasePaths();
		expect(state.invoke).toHaveBeenCalledWith('profile_paths', { id: 'profile-A' });
		expect(paths.databasePath).toBe('/data/profiles/profile-A/notchy.db');
	});
});
