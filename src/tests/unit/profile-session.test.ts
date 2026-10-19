import { describe, expect, it, vi } from 'vitest';
import { assertCurrentSession, createSessionInvoker, type SessionInvoker } from '$lib/profiles/session';

const a = { profileId: 'A', generation: 'gen-a' };
const b = { profileId: 'B', generation: 'gen-b' };

describe('profile session binding', () => {
	it('rejects the old generation even when the profile ID is unchanged', () => {
		expect(() => assertCurrentSession(a, { ...a, generation: 'new' })).toThrow();
	});
	it('captures A at invocation while the visible session changes to B', async () => {
		let release!: (value: string) => void;
		let current = a;
		const raw = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
		const bound = createSessionInvoker(a, raw as unknown as SessionInvoker, () => current);
		const pending = bound<string>('account_list', { marker: 'A' });
		current = b;
		expect(raw).toHaveBeenCalledWith('account_list', { marker: 'A', session: a });
		release('late A');
		await expect(pending).rejects.toThrow();
	});
});

describe('native domain session routing', () => {
	it('labels account, backup and schedule calls with the captured session', async () => {
		const { NativeDatabaseClient } = await import('$lib/db/native/client');
		const raw = vi.fn(async (_command: string, _args?: Record<string, unknown>) => []);
		const client = new NativeDatabaseClient(createSessionInvoker(a, raw as unknown as SessionInvoker));
		await client.accounts.list();
		await client.backup.create();
		await client.schedules.list();
		expect(raw.mock.calls.map((call) => call[0])).toEqual(['account_list', 'backup_create', 'schedule_list']);
		for (const call of raw.mock.calls) expect(call[1]).toEqual({ session: a });
	});
});
