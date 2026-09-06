// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
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

	it('names the locale toggle for screen readers', () => {
		render(TopBar);
		// Default locale is en, so the toggle announces its target: Vietnamese.
		expect(screen.getByRole('button', { name: 'Switch to Vietnamese' })).toBeInTheDocument();
	});

	it('renders a visible Shortcuts button without hover', () => {
		const onOpenShortcuts = vi.fn();
		render(TopBar, { props: { onOpenShortcuts } });
		const button = screen.getByRole('button', { name: 'Shortcuts' });
		expect(button).toBeVisible();
	});

	it('calls onOpenShortcuts when the Shortcuts button is clicked', async () => {
		const onOpenShortcuts = vi.fn();
		render(TopBar, { props: { onOpenShortcuts } });
		await fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }));
		expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
	});
});
