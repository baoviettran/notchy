import { describe, expect, it, vi } from 'vitest';
import { NativeProfilePort } from '$lib/profiles/native';

const session = { profileId: 'A', generation: 'g1' };

describe('native backup recovery', () => {
	it('inspects a selected backup and restores it as a separate profile', async () => {
		const preview = { token: 'preview-token', suggestedName: 'Recovered', schemaVersion: 7 };
		const created = { id: 'B', name: 'Recovered', createdAt: '2026-01-01T00:00:00Z' };
		const invoke = vi.fn(async (command: string) => command === 'profile_inspect_restore' ? preview : created);
		const port = new NativeProfilePort(invoke as any);
		expect(await port.inspectRestore('/chosen/backup.sqlite')).toEqual(preview);
		expect(await port.restore(preview.token, 'Recovered', { operationId: 'op', transitionToken: null })).toEqual(created);
		expect(invoke.mock.calls.map(([command]) => command)).toEqual(['profile_inspect_restore', 'profile_restore']);
		expect(invoke).toHaveBeenNthCalledWith(2, 'profile_restore', {
			token: preview.token, name: 'Recovered', context: { operationId: 'op', transitionToken: null }
		});
		void session;
	});
});
