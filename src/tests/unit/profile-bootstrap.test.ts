import { describe, expect, it, vi } from 'vitest';
import { BrowserProfilePort } from '$lib/profiles/browser';
import { ProfilesStore } from '$lib/stores/profiles.svelte';
import type { DatabaseService } from '$lib/db/browser/service';

describe('profile bootstrap', () => {
	it('opens an empty picker without creating a database and binds only after explicit creation', async () => {
		const createDatabase = vi.fn(async () => ({} as DatabaseService));
		const bind = vi.fn();
		const loadSettings = vi.fn(async () => {});
		const port = new BrowserProfilePort({ createDatabase });
		const store = new ProfilesStore({
			port, bind, reset: vi.fn(), loadSettings, catchUp: vi.fn(async () => {}),
			barrier: vi.fn(async () => ({ token: null, release: async () => {} }))
		});
		const initial = await store.bootstrap();
		expect(initial.profiles).toEqual([]);
		expect(initial.active).toBeNull();
		expect(createDatabase).not.toHaveBeenCalled();
		expect(loadSettings).not.toHaveBeenCalled();
		expect(bind).toHaveBeenCalledWith(null, null);
		const selected = await store.createAndOpen('Personal');
		expect(createDatabase).toHaveBeenCalledTimes(1);
		expect(selected.profileId).toBe(store.snapshot?.profiles[0].id);
		expect(loadSettings).toHaveBeenCalledWith(selected);
	});
});
