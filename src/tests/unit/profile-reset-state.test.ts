import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
import { accounts } from '$lib/stores/accounts.svelte';
import { transactions } from '$lib/stores/transactions.svelte';
import { resetProfileState } from '$lib/profiles/reset-state';

describe('profile state reset', () => {
	it('clears cached finance rows and rejects a delayed prior-profile load', async () => {
		let release!: (value: unknown[]) => void;
		mocks.getDb.mockReturnValue({ accounts: { list: () => new Promise((resolve) => { release = resolve; }) } });
		const pending = accounts.load();
		accounts.items = [{ id: 'old' } as never];
		transactions.items = [{ id: 'old' } as never];
		resetProfileState({ profileId: 'B', generation: 'b1' });
		expect(accounts.items).toEqual([]);
		expect(transactions.items).toEqual([]);
		release([{ id: 'late A' }]);
		await pending;
		expect(accounts.items).toEqual([]);
	});
});
