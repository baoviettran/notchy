// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

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
});
