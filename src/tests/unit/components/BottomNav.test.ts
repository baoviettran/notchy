// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BottomNav from '$lib/components/layout/BottomNav.svelte';

describe('BottomNav', () => {
	it('renders the 4 primary nav links', () => {
		render(BottomNav);
		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Trans')).toBeInTheDocument();
		expect(screen.getByText('Budget')).toBeInTheDocument();
		expect(screen.getByText('Reports')).toBeInTheDocument();
	});

	it('renders a More button that opens the secondary-item sheet', async () => {
		render(BottomNav);
		const moreBtn = screen.getByText('More');
		expect(moreBtn).toBeInTheDocument();
		expect(screen.queryByText('Accounts')).not.toBeInTheDocument();
		await fireEvent.click(moreBtn);
		expect(screen.getByText('Accounts')).toBeInTheDocument();
		expect(screen.getByText('Goals')).toBeInTheDocument();
		expect(screen.getByText('Debts')).toBeInTheDocument();
		expect(screen.getByText('Settings')).toBeInTheDocument();
	});

	it('closes the More sheet when a secondary link is clicked', async () => {
		render(BottomNav);
		await fireEvent.click(screen.getByText('More'));
		await fireEvent.click(screen.getByText('Goals'));
		expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument();
	});
});
