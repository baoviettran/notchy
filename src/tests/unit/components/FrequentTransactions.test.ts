// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FrequentTransactions from '$lib/components/sections/FrequentTransactions.svelte';

// Mock getDb to return a mock that resolves getFrequent
vi.mock('$lib/db', () => ({
	getDb: () => ({
		transactions: {
			getFrequent: vi.fn().mockResolvedValue([
				{ id: '1', payee: 'Coffee', kind: 'expense', amount: 30000, account_id: 'acc1', tag_id: null },
				{ id: '2', payee: 'Lunch', kind: 'expense', amount: 50000, account_id: 'acc1', tag_id: null },
				{ id: '3', payee: 'Salary', kind: 'income', amount: 10000000, account_id: 'acc1', tag_id: null },
			])
		}
	})
}));

vi.mock('$lib/stores/transactions.svelte', () => ({
	transactions: { create: vi.fn().mockResolvedValue('new-id'), delete: vi.fn() }
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: vi.fn() }
}));

beforeEach(() => {
	vi.useFakeTimers();
});

describe('FrequentTransactions', () => {
	it('marks armed button with data-arming attribute for CSS countdown', async () => {
		render(FrequentTransactions);
		// Wait for items to load
		await screen.findByText('Coffee');

		// The container with the 3 frequent items is inside a section; query
		// by the truncated payee text inside each button.
		const coffeeButton = screen.getByText('Coffee', { selector: '.text-xs' }).closest('button')!;
		expect(coffeeButton).not.toHaveAttribute('data-arming');

		// First tap arms the card
		await fireEvent.click(coffeeButton);
		expect(coffeeButton).toHaveAttribute('data-arming');
		expect(coffeeButton).toHaveAttribute('aria-pressed', 'true');
	});

	it('removes data-arming after the 4s disarm window', async () => {
		render(FrequentTransactions);
		await screen.findByText('Coffee');

		const coffeeButton = screen.getByText('Coffee', { selector: '.text-xs' }).closest('button')!;

		await fireEvent.click(coffeeButton);
		expect(coffeeButton).toHaveAttribute('data-arming');

		// Advance past the 4s window and flush Svelte microtasks
		await vi.advanceTimersByTimeAsync(4100);

		// data-arming should be removed after disarm
		expect(coffeeButton).not.toHaveAttribute('data-arming');
	});
});
