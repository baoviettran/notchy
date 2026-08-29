// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import ShortcutRef from '$lib/components/layout/ShortcutRef.svelte';

describe('ShortcutRef', () => {
	it('renders the dialog title and all four shortcut mappings', () => {
		render(ShortcutRef, { open: true });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();

		for (const label of ['New transaction', 'Search', 'Show this dialog', 'Close dialog']) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		// One <kbd> per shortcut row, in the documented key order.
		const keys = screen.getAllByText(/^(n|\/|\?|Esc)$/);
		expect(keys.map((el) => el.textContent)).toEqual(['n', '/', '?', 'Esc']);
	});

	it('renders nothing while closed', () => {
		render(ShortcutRef, { open: false });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
	});
});