// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import TopBar from '$lib/components/layout/TopBar.svelte';

describe('TopBar', () => {
	it('does not render the app name/logo (lives in Sidebar)', () => {
		render(TopBar);
		expect(screen.queryByRole('link', { name: 'Notchy' })).not.toBeInTheDocument();
	});

	it('does not render a hamburger menu button', () => {
		render(TopBar);
		expect(screen.queryByLabelText('Menu')).not.toBeInTheDocument();
	});

	it('renders the language toggle', () => {
		render(TopBar);
		expect(screen.getByText('VI')).toBeInTheDocument();
	});

	it('renders a search input', () => {
		render(TopBar);
		expect(screen.getByRole('searchbox')).toBeInTheDocument();
	});
});
