// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// The FAB keys off `uiHints.hideFab` to decide whether the quick-add button
// exists at all. The real store reads persisted prefs; a hoisted object lets
// each test flip the flag before render.
const mockUiHints = vi.hoisted(() => ({ hideFab: false }));
vi.mock('$lib/stores/ui-hint.svelte', () => ({
	uiHints: mockUiHints
}));

import FAB from '$lib/components/layout/FAB.svelte';

describe('FAB', () => {
	beforeEach(() => {
		mockUiHints.hideFab = false;
	});

	it('renders the quick-add button with its label and tour hook', () => {
		render(FAB, { onclick: () => {} });
		const btn = screen.getByRole('button', { name: 'Add transaction (N)' });
		expect(btn).toHaveAttribute('data-tour', 'add');
	});

	it('invokes onclick when clicked', async () => {
		const onclick = vi.fn();
		render(FAB, { onclick });
		await fireEvent.click(screen.getByRole('button', { name: 'Add transaction (N)' }));
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	it('hides the button when the add hint is suppressed', () => {
		mockUiHints.hideFab = true;
		render(FAB, { onclick: () => {} });
		expect(screen.queryByRole('button', { name: 'Add transaction (N)' })).not.toBeInTheDocument();
	});
});