import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Schedule } from '$lib/db/client';

const mocks = vi.hoisted(() => ({
	scheduleOps: {
		list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
		listDue: vi.fn(), markPosted: vi.fn(), markErrored: vi.fn(),
	},
	getDb: vi.fn(),
}));

vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
import { SchedulesStore } from '$lib/stores/schedules.svelte';

const base: Schedule = {
	id: '', name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
	transfer_account_id: null, tag_id: null, payee: null, description: null,
	frequency: 'monthly', start_date: '2026-01-31', end_date: null, posts_transaction: 1,
	next_due_date: '2026-01-31', last_posted_date: null, completed: 0, enabled: 1,
	errored_at: null, created_at: 'x', updated_at: 'x',
};

describe('SchedulesStore.resume', () => {
	let store: SchedulesStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDb.mockReturnValue({ schedules: mocks.scheduleOps });
		mocks.scheduleOps.update.mockResolvedValue(undefined);
		mocks.scheduleOps.list.mockResolvedValue([
			{ ...base, id: 'disabled', enabled: 0 },
			{ ...base, id: 'parked', errored_at: '2026-05-01T00:00:00Z' },
		]);
		store = new SchedulesStore();
	});

	it('re-anchors the due date when a disabled schedule is re-enabled', async () => {
		await store.load();

		await store.resume('disabled', '2026-06-01');

		const [, input] = mocks.scheduleOps.update.mock.calls[0];
		// Jan 31 monthly, five months later: the disabled period is skipped, not replayed.
		expect(input.next_due_date).toBe('2026-06-28');
		expect(input.enabled).toBe(1);
		// The full-field projection is what stops a resume from blanking the rest.
		expect(input).toMatchObject({ frequency: 'monthly', start_date: '2026-01-31', amount: 5_000_000 });
	});

	it('keeps the stored due date when resuming a parked schedule', async () => {
		await store.load();

		await store.resume('parked', '2026-06-01');

		const [, input] = mocks.scheduleOps.update.mock.calls[0];
		// null leaves the stored date, so the backlog keeps draining (Task 8).
		expect(input.next_due_date).toBeNull();
		expect(input.enabled).toBe(1);
	});
});
