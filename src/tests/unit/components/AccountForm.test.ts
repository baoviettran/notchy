// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// Mock the global stores — the real ones call getDb()/sql.js which can't run in jsdom.
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock('$lib/stores/accounts.svelte', () => ({
	accounts: { items: [], load: vi.fn(), create: mockCreate, update: mockUpdate }
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: vi.fn() }
}));

import AccountForm from '$lib/components/forms/AccountForm.svelte';
import type { AccountWithBalance } from '$lib/db/repos/accounts';

const editAccount: AccountWithBalance = {
	id: 'acc-1', name: 'Existing', type: 'checking', counterparty: null,
	currency: 'USD', archived: 0, created_at: '', updated_at: '', balance: 0
};

describe('AccountForm', () => {
	beforeEach(() => {
		mockCreate.mockReset();
		mockUpdate.mockReset();
		mockCreate.mockResolvedValue('acc-new');
		mockUpdate.mockResolvedValue(undefined);
	});

	it('renders Name input and Type select, with no counterparty field for a non-loan type', () => {
		render(AccountForm, { account: null });
		expect(screen.getByLabelText('Name')).toBeInTheDocument();
		expect(screen.getByLabelText('Type')).toBeInTheDocument();
		expect(screen.queryByLabelText('Counterparty')).not.toBeInTheDocument();
	});

	it('reveals the counterparty field when the type switches to a loan type', async () => {
		render(AccountForm, { account: null });
		const typeSelect = screen.getByLabelText('Type');
		await fireEvent.change(typeSelect, { target: { value: 'loan_to_person' } });
		expect(screen.getByLabelText('Counterparty')).toBeInTheDocument();
	});

	it('validates a loan account requires a counterparty (error, no create call)', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: null, onclose });
		const typeSelect = screen.getByLabelText('Type');
		await fireEvent.change(typeSelect, { target: { value: 'loan_to_person' } });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Loan' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Counterparty is required for loan accounts')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('requires a name — empty name shows the error and does not create', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: null, onclose });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: '   ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Name is required')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('rejects a non-numeric initial balance with an error and no create', async () => {
		render(AccountForm, { account: null });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Wallet' } });
		await fireEvent.input(screen.getByLabelText('Initial balance (optional)'), { target: { value: 'abc' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(screen.getByText('Invalid amount')).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('creates with a parsed integer balance, name and chosen type', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: null, onclose });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Wallet' } });
		await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'cash' } });
		await fireEvent.input(screen.getByLabelText('Initial balance (optional)'), { target: { value: '100000' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
		const [payload] = mockCreate.mock.calls[0];
		expect(payload.name).toBe('Wallet');
		expect(payload.type).toBe('cash');
		expect(payload.initial_balance).toBe(100000);
		expect(payload.counterparty).toBeNull();
		expect(onclose).toHaveBeenCalled();
	});

	it('creates a loan account with its counterparty', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: null, onclose });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Dad' } });
		await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'loan_from_person' } });
		await fireEvent.input(screen.getByLabelText('Counterparty'), { target: { value: 'Dad' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
		const [payload] = mockCreate.mock.calls[0];
		expect(payload.type).toBe('loan_from_person');
		expect(payload.counterparty).toBe('Dad');
	});

	it('edit mode hides the balance field, clears counterparty for non-loan types, and updates', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: editAccount, onclose });
		expect(screen.queryByLabelText('Initial balance (optional)')).not.toBeInTheDocument();
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
		const [id, patch] = mockUpdate.mock.calls[0];
		expect(id).toBe('acc-1');
		expect(patch.name).toBe('Renamed');
		expect(patch.counterparty).toBeNull();
		expect(onclose).toHaveBeenCalled();
	});

	it('cancel invokes onclose without creating', async () => {
		const onclose = vi.fn();
		render(AccountForm, { account: null, onclose });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onclose).toHaveBeenCalled();
		expect(mockCreate).not.toHaveBeenCalled();
	});
});