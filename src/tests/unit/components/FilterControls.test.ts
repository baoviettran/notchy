// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// FilterControls fans account/category options out of these stores for its two
// selects; the real stores hit sql.js which can't live in jsdom.
vi.mock('$lib/stores/accounts.svelte', () => ({
	accounts: {
		items: [
			{ id: 'acc-1', name: 'Checking', archived: 0 },
			{ id: 'acc-2', name: 'Wallet', archived: 0 }
		]
	}
}));
vi.mock('$lib/stores/categories.svelte', () => ({
	categories: {
		tags: [
			{ id: 'tag-1', name: 'Food' },
			{ id: 'tag-2', name: 'Housing' }
		]
	}
}));

import FilterControlsBindProbe from './helpers/FilterControlsBindProbe.svelte';

describe('FilterControls', () => {
	it('renders all four filters with "All" defaults and store-backed options', () => {
		render(FilterControlsBindProbe);
		expect(screen.getByLabelText('Kind')).toBeInTheDocument();
		expect(screen.getByLabelText('Account')).toBeInTheDocument();
		expect(screen.getByLabelText('Tag')).toBeInTheDocument();
		expect(screen.getByLabelText('Month')).toBeInTheDocument();

		// Default "All" options.
		expect(screen.getByRole('option', { name: 'All kinds' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'All accounts' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'All tags' })).toBeInTheDocument();

		// Kind variants.
		for (const label of ['Expense', 'Income', 'Transfer', 'Refund', 'Adjustment']) {
			expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
		}
		// Store-derived account + tag options.
		expect(screen.getByRole('option', { name: 'Checking' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'Food' })).toBeInTheDocument();
	});

	it('binds a chosen kind back to the parent', async () => {
		render(FilterControlsBindProbe);
		await fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'expense' } });
		expect(screen.getByTestId('kind').textContent).toBe('expense');
	});

	it('binds a chosen account back to the parent', async () => {
		render(FilterControlsBindProbe);
		await fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'acc-1' } });
		expect(screen.getByTestId('account').textContent).toBe('acc-1');
	});

	it('binds a chosen tag back to the parent', async () => {
		render(FilterControlsBindProbe);
		await fireEvent.change(screen.getByLabelText('Tag'), { target: { value: 'tag-2' } });
		expect(screen.getByTestId('tag').textContent).toBe('tag-2');
	});

	it('binds the month input back to the parent', async () => {
		render(FilterControlsBindProbe);
		// Svelte's bind:value on a text-family <input> listens on the `input`
		// event (selects/checkboxes use `change`), so fire `input` here.
		await fireEvent.input(screen.getByLabelText('Month'), { target: { value: '2026-08' } });
		expect(screen.getByTestId('month').textContent).toBe('2026-08');
	});
});