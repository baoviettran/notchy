import { describe, expect, it, vi } from 'vitest';
import { ProfilesStore, type ProfilesStoreDependencies } from '$lib/stores/profiles.svelte';
import type { ProfilePort } from '$lib/profiles/port';
import type { ProfileSession, ProfileSnapshot } from '$lib/profiles/types';

const a = { profileId: 'A', generation: 'a1' };
const b = { profileId: 'B', generation: 'b1' };
const recordA = { id: 'A', name: 'Home', createdAt: '2026-01-01T00:00:00Z' };
const recordB = { id: 'B', name: 'Work', createdAt: '2026-01-02T00:00:00Z' };
function fixture(active: ProfileSession | null = a) {
	let state: ProfileSnapshot = { profiles: [recordA, recordB], active, phase: 'idle', preferences: { locale: 'en', theme: 'light' }, recovery: null };
	const port = {
		load: vi.fn(async () => state),
		activate: vi.fn(async (id: string) => { state = { ...state, active: id === 'A' ? { ...a, generation: 'a2' } : b }; return state.active!; }),
		create: vi.fn(async (name: string) => { const record = { ...recordB, id: 'C', name }; state = { ...state, profiles: [...state.profiles, record] }; return record; }),
		reset: vi.fn(async (id: string) => { if (state.active?.profileId === id) state = { ...state, active: { profileId: id, generation: 'new' } }; }),
		delete: vi.fn(async (id: string) => { state = { ...state, profiles: state.profiles.filter((p) => p.id !== id), active: state.active?.profileId === id ? null : state.active }; return { cleanupPending: false }; }),
		restore: vi.fn(async (_token: string, name: string) => { const record = { ...recordB, id: 'R', name }; state = { ...state, profiles: [...state.profiles, record] }; return record; }),
		databaseFor: vi.fn(() => ({})),
	} as unknown as ProfilePort;
	const bind = vi.fn();
	const reset = vi.fn();
	const loadSettings = vi.fn(async () => {});
	const catchUp = vi.fn(async () => {});
	const barrier: ProfilesStoreDependencies['barrier'] = vi.fn(async () => ({ token: 'approved', release: vi.fn(async () => {}) }));
	const deps: ProfilesStoreDependencies = { port, bind, reset, loadSettings, catchUp, barrier };
	return { store: new ProfilesStore(deps), port, bind, reset, loadSettings, catchUp, barrier, setState: (next: ProfileSnapshot) => { state = next; } };
}

describe('profile lifecycle store', () => {
	it('binds a new session and clears prior state before loading profile settings', async () => {
		const f = fixture();
		await f.store.load();
		await f.store.switchTo('B');
		expect(f.store.snapshot?.active).toEqual(b);
		expect(f.bind).toHaveBeenCalledWith(b, expect.anything());
		expect(f.reset).toHaveBeenCalledWith(b);
		expect(f.loadSettings).toHaveBeenCalledWith(b);
		expect(f.catchUp).toHaveBeenCalledTimes(2);
		await f.store.load();
		expect(f.catchUp).toHaveBeenCalledTimes(2);
	});
	it('reloads authoritative rollback session when activation fails', async () => {
		const f = fixture();
		await f.store.load();
		vi.mocked(f.port.activate).mockRejectedValueOnce(new Error('open failed'));
		f.setState({ ...f.store.snapshot!, active: { ...a, generation: 'a2' } });
		await expect(f.store.switchTo('B')).rejects.toThrow('open failed');
		expect(f.store.snapshot?.active).toEqual({ ...a, generation: 'a2' });
		expect(f.bind).toHaveBeenLastCalledWith({ ...a, generation: 'a2' }, expect.anything());
	});
	it('keeps a valid created profile listed even if opening it fails', async () => {
		const f = fixture();
		await f.store.load();
		vi.mocked(f.port.activate).mockRejectedValueOnce(new Error('open failed'));
		await expect(f.store.createAndOpen('New')).rejects.toThrow('open failed');
		expect(f.store.snapshot?.profiles.some((p) => p.id === 'C')).toBe(true);
	});
	it('rebinding after reset uses a new generation', async () => {
		const f = fixture();
		await f.store.load();
		await f.store.reset('A');
		expect(f.store.snapshot?.active).toEqual({ profileId: 'A', generation: 'new' });
		expect(f.reset).toHaveBeenLastCalledWith({ profileId: 'A', generation: 'new' });
	});
	it('reconciles a changed native generation after reset fails during rollback', async () => {
		const f = fixture();
		await f.store.load();
		vi.mocked(f.port.reset).mockRejectedValueOnce(new Error('reset failed'));
		f.setState({ ...f.store.snapshot!, active: { ...a, generation: 'rollback' } });
		await expect(f.store.reset('A')).rejects.toThrow('reset failed');
		expect(f.store.snapshot?.active?.generation).toBe('rollback');
		expect(f.bind).toHaveBeenLastCalledWith({ ...a, generation: 'rollback' }, expect.anything());
	});
	it('does not switch away from current drafts when restoring as a new profile', async () => {
		const f = fixture();
		await f.store.load();
		await f.store.restore('preview', 'Recovered');
		expect(f.store.snapshot?.active).toEqual(a);
		expect(f.barrier).not.toHaveBeenCalled();
	});
	it('shows an empty picker when there is no active profile', async () => {
		const f = fixture(null);
		f.setState({ ...f.store.snapshot!, profiles: [], active: null });
		await f.store.load();
		expect(f.store.snapshot?.active).toBeNull();
		expect(f.bind).toHaveBeenCalledWith(null, null);
	});
});

describe('blocked profile transitions', () => {
	it('exposes participants and lets the user cancel a waiting transition', async () => {
		const f = fixture();
		await f.store.load();
		let release!: () => void;
		vi.mocked(f.barrier).mockImplementation(async (_expected: ProfileSession | null, onPending?: Parameters<ProfilesStoreDependencies['barrier']>[1]) => {
			onPending?.({ requestId: 'pending', requiredLabels: ['main', 'quick-add'] }, async () => { release(); });
			await new Promise<void>((resolve) => { release = resolve; });
			throw new Error('profile transition canceled');
		});
		const pending = f.store.switchTo('B');
		await vi.waitFor(() => expect(f.store.pendingTransition?.requiredLabels).toContain('quick-add'));
		await f.store.cancelPendingTransition();
		await expect(pending).rejects.toThrow('profile transition canceled');
		expect(f.store.pendingTransition).toBeNull();
	});
});

describe('profile lifecycle serialization', () => {
	it('rejects a second operation while a transition is pending', async () => {
		const f = fixture();
		await f.store.load();
		let release!: () => void;
		vi.mocked(f.barrier).mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => { release = resolve; });
			return { token: 'approved', release: async () => {} };
		});
		const first = f.store.switchTo('B');
		await vi.waitFor(() => expect(f.barrier).toHaveBeenCalled());
		await expect(f.store.switchTo('A')).rejects.toThrow('profile operation in progress');
		release();
		await first;
	});
});
