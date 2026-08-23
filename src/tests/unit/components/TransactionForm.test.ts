// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mockMatchTag = vi.hoisted(() => vi.fn());

// Mock stores to avoid sql.js wasm initialization in jsdom
vi.mock('$lib/stores/transactions.svelte', () => ({
	transactions: { items: [], load: vi.fn(), create: vi.fn(), update: vi.fn() }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
	accounts: { items: [], load: vi.fn() }
}));
vi.mock('$lib/stores/categories.svelte', () => ({
	categories: { tags: [], load: vi.fn() }
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'USD' }
}));
vi.mock('$lib/stores/session.svelte', () => ({
	session: { lastUsedAccountId: '', lastEnteredDate: '' }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: vi.fn() }
}));
vi.mock('$lib/stores/rules.svelte', () => ({
	rules: { matchTag: mockMatchTag, learnRule: vi.fn() }
}));

import TransactionForm from '$lib/components/forms/TransactionForm.svelte';

describe('TransactionForm', () => {
	it('renders the Amount input with autofocus before the kind toggles', () => {
		render(TransactionForm, { mode: 'full' });
		const amountInput = screen.getByLabelText('Amount');
		expect(amountInput).toHaveAttribute('autofocus');
		// The kind toggle labels exist (Expense, Income, Transfer, Refund, Adjustment)
		expect(screen.getByText('Expense')).toBeInTheDocument();
	});

	it('renders Amount before the Account select', () => {
		const { container } = render(TransactionForm, { mode: 'full' });
		const amountInput = container.querySelector('input#input-') ?? screen.getByLabelText('Amount');
		const accountSelect = screen.queryByLabelText('Account');
		expect(accountSelect).toBeInTheDocument();
		// Amount appears before Account in DOM order
		expect(amountInput.compareDocumentPosition(accountSelect!))
			.toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it('shows auto indicator when tag is auto-filled by rule', () => {
		const tagId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
		mockMatchTag.mockReturnValue(tagId);
		render(TransactionForm, { mode: 'full' });
		expect(screen.getByText('Auto')).toBeInTheDocument();
	});

	it('shows only expense and income kind buttons by default', () => {
		render(TransactionForm, { mode: 'full' });
		expect(screen.getByText('Expense')).toBeInTheDocument();
		expect(screen.getByText('Income')).toBeInTheDocument();
		expect(screen.queryByText('Transfer')).not.toBeInTheDocument();
		expect(screen.queryByText('Refund')).not.toBeInTheDocument();
		expect(screen.queryByText('Adjustment')).not.toBeInTheDocument();
	});

	it('expands advanced kinds when More is clicked', async () => {
		render(TransactionForm, { mode: 'full' });
		const moreButton = screen.getByText('More');
		expect(moreButton).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(moreButton);

		expect(moreButton).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByText('Transfer')).toBeInTheDocument();
		expect(screen.getByText('Refund')).toBeInTheDocument();
		expect(screen.getByText('Adjustment')).toBeInTheDocument();
	});

	it('selects an advanced kind after expanding', async () => {
		render(TransactionForm, { mode: 'full' });
		await fireEvent.click(screen.getByText('More'));
		await fireEvent.click(screen.getByText('Transfer'));
		// Transfer is selected, so the Transfer kind button should show pressed state
		const transferButton = screen.getByText('Transfer');
		expect(transferButton).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByText('Expense')).toHaveAttribute('aria-pressed', 'false');
	});

	it('attaches the invalid-amount error to the amount field, not the form header', async () => {
		const { container } = render(TransactionForm, { mode: 'full' });
		const amountInput = screen.getByLabelText('Amount');
		await fireEvent.input(amountInput, { target: { value: 'not a number' } });
		await fireEvent.submit(container.querySelector('form')!);

		expect(screen.getByText('Invalid amount')).toBeInTheDocument();
		const alert = screen.getByRole('alert');
		// The alert lives inside the same wrapper as the Amount input
		expect(alert.closest('div')!.contains(amountInput)).toBe(true);
	});

	it('attaches the missing-account error to the account select', async () => {
		const { container } = render(TransactionForm, { mode: 'full' });
		await fireEvent.input(screen.getByLabelText('Amount'), { target: { value: '100' } });
		await fireEvent.submit(container.querySelector('form')!);

		expect(screen.getByText('Select an account')).toBeInTheDocument();
		const alert = screen.getByRole('alert');
		const accountSelect = screen.getByLabelText('Account');
		expect(alert.closest('div')!.contains(accountSelect)).toBe(true);
	});

	it('submits from a real form so Enter saves', () => {
		const { container } = render(TransactionForm, { mode: 'full' });
		// The wrapper must be a <form> with a submit button — the n-shortcut
		// flow ends hands-on-keyboard, so Enter in any field submits.
		expect(container.querySelector('form')).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
	});
});
