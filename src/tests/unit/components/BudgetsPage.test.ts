// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';

// The page (and the stores it drives) must reach the DB only through the domain
// port `getDb()`. We inject a fake AppDatabase so the assertions are about the
// page's error handling and its month-scoped guards, not the storage.
vi.mock('$lib/db', () => ({ getDb: vi.fn() }));

import { getDb } from '$lib/db';
import { toast } from '$lib/stores/toast.svelte';
import { budgets } from '$lib/stores/budgets.svelte';
import { categories } from '$lib/stores/categories.svelte';
import BudgetsPage from '../../../routes/budgets/+page.svelte';

const POOL = {
	income: 0, carried_forward: 0, last_month_overspent: 0,
	assigned: 0, to_budget: 0, overassigned: 0
};

const BUCKET = {
	id: 'bucket_essentials', name: 'Essentials', is_system: 1,
	budgetable: 1, rollover_enabled: 1, sort_order: 0, created_at: '', updated_at: ''
};

function fakeDb() {
	return {
		budgets: {
			getForMonth: vi.fn().mockResolvedValue([]),
			getToBudget: vi.fn().mockResolvedValue(POOL),
			hasAllocations: vi.fn().mockResolvedValue(false),
			setAllocation: vi.fn().mockResolvedValue(undefined),
			copyFromPreviousMonth: vi.fn().mockResolvedValue(undefined)
		},
		categories: {
			listBuckets: vi.fn().mockResolvedValue([BUCKET]),
			listTags: vi.fn().mockResolvedValue([]),
			setRolloverEnabled: vi.fn().mockResolvedValue(undefined)
		},
		meta: {
			get: vi.fn().mockResolvedValue(null),
			getCurrency: vi.fn().mockResolvedValue('VND'),
			isFirstRunComplete: vi.fn().mockResolvedValue(true)
		}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// The stores are module singletons; reset the fields each test touches.
	budgets.month = '2026-10';
	budgets.items = [];
	budgets.toBudget = null;
	budgets.hasAllocations = false;
	budgets.error = null;
	budgets.loading = false;
	categories.buckets = [];
	categories.tags = [];
	categories.error = null;
	categories.loading = false;
});

describe('budgets page — rollover toggle failure', () => {
	it('surfaces a failed write and reverts the control to the stored flag', async () => {
		const db = fakeDb();
		db.categories.setRolloverEnabled = vi.fn().mockRejectedValue(new Error('write failed'));
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);
		const show = vi.spyOn(toast, 'show');

		render(BudgetsPage);
		const box = (await screen.findByRole('checkbox')) as HTMLInputElement;
		expect(box.checked).toBe(true);

		// Flip it off; the write rejects before the store reloads.
		await fireEvent.click(box);
		expect(db.categories.setRolloverEnabled).toHaveBeenCalledWith('bucket_essentials', false);

		// The failure is surfaced (the page's toast-on-error idiom)…
		await waitFor(() => expect(show).toHaveBeenCalled());
		// …and the control snaps back to the stored flag (1), not the flipped DOM state.
		await waitFor(() => expect(box.checked).toBe(true));
		show.mockRestore();
	});
});

describe('budgets page — previous-month guard', () => {
	it('ignores a stale hasAllocations result that lands after a newer month', async () => {
		let resolveStale!: (v: boolean) => void;
		const db = fakeDb();
		// 2026-10 is the initial month; its previous-month check (2026-09) hangs.
		// 2026-11's previous month (2026-10) reports allocations.
		db.budgets.hasAllocations = vi.fn((month: string) => {
			if (month === '2026-09') return new Promise<boolean>((r) => { resolveStale = r; });
			return Promise.resolve(month === '2026-10');
		});
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		render(BudgetsPage);
		await waitFor(() => expect(db.budgets.hasAllocations).toHaveBeenCalledWith('2026-09'));

		// Advance to 2026-11: the "Copy from previous" guard should show.
		await fireEvent.click(screen.getByLabelText(m.budgets_next_month()));
		await waitFor(() => expect(screen.queryByText(m.budgets_copy_from_previous())).not.toBeNull());

		// The stale 2026-09 check now resolves false. It belongs to the outgoing
		// month and must not clear the guard for 2026-11. Settle microtasks +
		// Svelte's flush before asserting, so a late write is not missed.
		resolveStale(false);
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByText(m.budgets_copy_from_previous())).not.toBeNull();
	});
});
