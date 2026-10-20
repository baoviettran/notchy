import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (event: { payload: unknown }) => void>();
	const invoke = vi.fn();
	const listen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
		handlers.set(name, handler);
		return () => { handlers.delete(name); };
	});
	return { handlers, invoke, listen };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

import { requestProfileTransition } from '$lib/profiles/windows';

const session = { profileId: 'A', generation: 'g1' };

describe('profile window transition', () => {
	it('keeps a ready event emitted before prepare returns', async () => {
		mocks.invoke.mockImplementation(async (command: string) => {
			if (command === 'profile_prepare_transition') {
				mocks.handlers.get('profile:transition-ready')?.({ payload: { requestId: 'request-1', transitionToken: 'token-1' } });
				return { requestId: 'request-1', expectedSession: session, requiredLabels: ['main'] };
			}
		});
		const pending = await requestProfileTransition(session);
		expect(await pending.token).toBe('token-1');
		expect(mocks.handlers.has('profile:transition-ready')).toBe(false);
	});
});
