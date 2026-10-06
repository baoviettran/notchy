// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// The form reads settings for locale/currency-aware amount parsing and shows
// errors through the toast bus. Neither should reach the DB, so both are mocked.
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: vi.fn() }
}));

import ScheduleForm from '$lib/components/forms/ScheduleForm.svelte';
import { toUpdateFields } from '$lib/stores/schedules.svelte';
import type { Schedule } from '$lib/db/client';
import * as m from '$lib/paraglide/messages';

const accountList = [{ id: 'acct1', name: 'Checking' }];
const tagList = [{ id: 'tag1', name: 'Bills' }];

/** The stored row the edit cases start from — every field non-default, so a
 *  dropped field is visible in the assertion rather than coincidentally equal. */
const stored: Schedule = {
	id: 'sch1', name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
	transfer_account_id: null, tag_id: 'tag1', payee: 'Landlord', description: 'monthly',
	frequency: 'monthly', start_date: '2026-01-31', end_date: '2027-01-31',
	posts_transaction: 1, next_due_date: '2026-01-31', last_posted_date: null,
	completed: 0, enabled: 1, errored_at: null, created_at: 'x', updated_at: 'x',
};

describe('ScheduleForm', () => {
	it('submits an integer amount and an ISO start date', async () => {
		const onsubmit = vi.fn();
		render(ScheduleForm, { props: { accounts: accountList, tags: tagList, onsubmit } });

		await fireEvent.input(screen.getByLabelText(m.schedules_name()), { target: { value: 'Rent' } });
		await fireEvent.input(screen.getByLabelText(m.schedules_amount()), { target: { value: '5000000' } });
		await fireEvent.click(screen.getByRole('button', { name: m.schedules_save() }));

		await waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1));
		const input = onsubmit.mock.calls[0][0];
		// No float anywhere on the path from the input to the argument.
		expect(input.amount).toBe(5_000_000);
		expect(Number.isInteger(input.amount)).toBe(true);
		expect(input.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('requires a destination account when the kind is transfer, and hides the category', async () => {
		const onsubmit = vi.fn();
		render(ScheduleForm, { props: { accounts: accountList, tags: tagList, onsubmit } });

		// Valid name + amount, so the only thing that can block the submit is the
		// missing destination — otherwise this test would pass for the wrong reason.
		await fireEvent.input(screen.getByLabelText(m.schedules_name()), { target: { value: 'Move' } });
		await fireEvent.input(screen.getByLabelText(m.schedules_amount()), { target: { value: '1000' } });
		await fireEvent.click(screen.getByRole('radio', { name: m.schedules_kind_transfer() }));

		// The destination picker appears and the category picker goes away — the DB
		// CHECK rejects both mismatches, so the form must not offer them.
		expect(screen.getByLabelText(m.schedules_transfer_account())).toBeInTheDocument();
		expect(screen.queryByLabelText(m.schedules_category())).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: m.schedules_save() }));
		expect(onsubmit).not.toHaveBeenCalled(); // destination is required
	});

	it('caps payee and description at the schema limits, not lower', () => {
		render(ScheduleForm, { props: { accounts: accountList, tags: tagList, onsubmit: vi.fn() } });

		// The schedules DDL allows payee <= 128 and description <= 1024
		// (migrations.rs:754-755). A lower maxlength truncates a paste with no
		// error, so the form must not be stricter than the schema accepts.
		expect(screen.getByLabelText(m.schedules_payee())).toHaveAttribute('maxlength', '128');
		expect(screen.getByLabelText(m.schedules_description())).toHaveAttribute('maxlength', '1024');
	});

	it('submits the existing schedule fields unchanged when only the amount is edited', async () => {
		const onsubmit = vi.fn();
		render(ScheduleForm, {
			props: { schedule: stored, accounts: accountList, tags: tagList, onsubmit }
		});

		await fireEvent.input(screen.getByLabelText(m.schedules_amount()), { target: { value: '6000000' } });
		await fireEvent.click(screen.getByRole('button', { name: m.schedules_save() }));

		await waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1));
		expect(onsubmit).toHaveBeenCalledWith({
			...toUpdateFields(stored), // the same projection the store uses
			amount: 6_000_000,
		});
		// Spelled out, because these are what a partial submit silently destroys:
		expect(onsubmit.mock.calls[0][0]).toMatchObject({
			frequency: 'monthly', start_date: '2026-01-31', end_date: '2027-01-31',
			tag_id: 'tag1', payee: 'Landlord', enabled: 1,
		});
	});

	it('preserves the park when a parked schedule is edited', async () => {
		const onsubmit = vi.fn();
		const parked: Schedule = { ...stored, enabled: 1, errored_at: '2026-02-01T00:00:00.000Z' };
		render(ScheduleForm, {
			props: { schedule: parked, accounts: accountList, tags: tagList, onsubmit }
		});

		await fireEvent.input(screen.getByLabelText(m.schedules_amount()), { target: { value: '6000000' } });
		await fireEvent.click(screen.getByRole('button', { name: m.schedules_save() }));

		await waitFor(() => expect(onsubmit).toHaveBeenCalledTimes(1));
		// `updateSchedule` clears `errored_at` on both adapters whenever `enabled = 1`,
		// so echoing the parked row's stored `enabled` would make Edit a second resume
		// path. The edit must submit `enabled: 0` and leave every other field as-is;
		// only the row's Resume control is allowed to un-park it.
		expect(onsubmit).toHaveBeenCalledWith({
			...toUpdateFields(stored),
			amount: 6_000_000,
			enabled: 0,
		});
	});
});
