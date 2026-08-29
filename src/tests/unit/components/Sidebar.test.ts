// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

// $app/stores resolves (via the components-project alias) to the app-stores-mock,
// whose `page` is a writable we can point at any route to drive aria-current.
import { page } from '$app/stores';

import Sidebar from '$lib/components/layout/Sidebar.svelte';

// svelte-check types `page` against the real $app/stores (a Readable with no
// `.set`), even though the vitest components project aliases it to a writable.
// Cast to the writable shape only at the set boundary so the rest of the file
// stays type-checked by the kit types.
const setPath = (pathname: string): void =>
	(page as unknown as { set: (p: { url: { pathname: string } }) => void }).set({ url: { pathname } });

describe('Sidebar', () => {
	beforeEach(() => {
		setPath('/');
	});

	it('renders brand, both nav groups, and the offline footer', () => {
		render(Sidebar);
		expect(screen.getByText('Notchy')).toBeInTheDocument();
		// Primary group.
		expect(screen.getByText('Ledger')).toBeInTheDocument();
		for (const label of ['Dashboard', 'Transactions', 'Budgets', 'Reports']) {
			expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
		}
		// Secondary group.
		expect(screen.getByText('More')).toBeInTheDocument();
		for (const label of ['Accounts', 'Goals', 'Debts', 'Settings']) {
			expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
		}
		expect(screen.getByText('Local · offline')).toBeInTheDocument();
	});

	it('marks the exact current route as active and leaves Dashboard inactive', () => {
		setPath('/budgets');
		render(Sidebar);
		expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
		expect(screen.getByRole('link', { name: 'Transactions' })).not.toHaveAttribute('aria-current');
	});

	it('marks the Dashboard active only on the root path', () => {
		setPath('/');
		render(Sidebar);
		expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Budgets' })).not.toHaveAttribute('aria-current');
	});

	it('treats a sub-route as active for its parent nav item', () => {
		setPath('/budgets/2026-08');
		render(Sidebar);
		expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute('aria-current', 'page');
	});

	it('marks a secondary nav item active on its route', () => {
		setPath('/accounts');
		render(Sidebar);
		expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');
	});
});