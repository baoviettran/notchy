// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// Mock the global stores — the real ones call getDb()/sql.js which can't run in jsdom.
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('$lib/stores/goals.svelte', () => ({
	goals: { items: [], load: vi.fn(), create: mockCreate, update: mockUpdate }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
	accounts: { items: [], load: vi.fn() }
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: vi.fn() }
}));

import GoalForm from '$lib/components/forms/GoalForm.svelte';
import type { GoalWithProgress, GoalType } from '$lib/db/repos/goals';

const editGoal: GoalWithProgress = {
	id: 'goal-1', name: 'Trip', type: 'savings', target_amount: 5000000,
	target_date: '2026-12-31', linked_account_id: null, starting_amount: 0,
	current_amount: 0, progress: 0,
	created_at: '', updated_at: ''
} as unknown as GoalWithProgress;

// Opens the target-date picker and selects "Today" so `targetDate` is non-empty.
async function pickToday() {
	await fireEvent.click(screen.getByLabelText('Target date'));
	await fireEvent.click(screen.getByText('Today'));
}

describe('GoalForm', () => {
	beforeEach(() => {
		mockCreate.mockReset();
		mockUpdate.mockReset();
		mockCreate.mockResolvedValue('goal-new');
		mockUpdate.mockResolvedValue(undefined);
	});

	it('renders with the default savings type and a "None" linked-account option', () => {
		render(GoalForm, { goal: null });
		expect(screen.getByLabelText('Name')).toBeInTheDocument();
		expect(screen.getByLabelText('Target amount')).toBeInTheDocument();
		expect(screen.queryByText('— None —')).toBeInTheDocument();
	});

	it('hides the linked-account select when type is net_worth', async () => {
		render(GoalForm, { goal: null });
		await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'net_worth' } });
		expect(screen.queryByLabelText('Linked account')).not.toBeInTheDocument();
	});

	it('requires a name before saving', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: null, onclose });
		await pickToday();
		await fireEvent.input(screen.getByLabelText('Target amount'), { target: { value: '100000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Name is required')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('requires a target date before saving', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: null, onclose });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Trip' } });
		await fireEvent.input(screen.getByLabelText('Target amount'), { target: { value: '100000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Target date is required')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('requires a target amount before saving', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: null, onclose });
		await pickToday();
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Trip' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Amount is required')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('creates a goal with the parsed integer target amount and today as date', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: null, onclose });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Trip' } });
		await fireEvent.input(screen.getByLabelText('Target amount'), { target: { value: '500000000' } });
		await pickToday();
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
		const [payload] = mockCreate.mock.calls[0];
		expect(payload.name).toBe('Trip');
		expect(payload.type).toBe('savings');
		expect(payload.target_amount).toBe(500000000);
		expect(payload.target_date).toBeTruthy();
		expect(payload.starting_amount).toBe(0);
		expect(onclose).toHaveBeenCalled();
	});

	it('edit mode disables the type select and updates instead of creating', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: editGoal, onclose });
		const typeSelect = screen.getByLabelText('Type');
		expect((typeSelect as HTMLSelectElement).disabled).toBe(true);
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Trip 2027' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
		const [id, patch] = mockUpdate.mock.calls[0];
		expect(id).toBe('goal-1');
		expect(patch.name).toBe('Trip 2027');
		expect(mockCreate).not.toHaveBeenCalled();
		expect(onclose).toHaveBeenCalled();
	});

	it('cancel invokes onclose without saving', async () => {
		const onclose = vi.fn();
		render(GoalForm, { goal: null, onclose });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onclose).toHaveBeenCalled();
		expect(mockCreate).not.toHaveBeenCalled();
	});
});