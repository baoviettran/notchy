// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { Snippet } from 'svelte';

import FilterSheet from '$lib/components/primitives/FilterSheet.svelte';
import { snip } from '../helpers/snippet';

// A string snippet isn't emitted as a visible text node, so children presence
// is proven by a spy that records whether `@render children?.()` invoked the
// snippet, not by querying text.
const body = snip('Filter controls live here');

describe('FilterSheet', () => {
	it('renders the dialog and scrim when open, and invokes the children snippet', () => {
		let invoked = 0;
		const spyBody = (() => { invoked++; return ''; }) as unknown as Snippet;
		const { container } = render(FilterSheet, { open: true, children: spyBody });
		expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
		// The scrim carries role="presentation", which the a11y tree prunes, so
		// query it structurally instead of by role.
		expect(container.querySelector('.fixed.inset-0')).not.toBeNull();
		expect(invoked).toBeGreaterThan(0);
	});

	it('closes via Escape on the window', () => {
		const onclose = vi.fn();
		render(FilterSheet, { open: true, onclose, children: body });
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('closes when the scrim is clicked', async () => {
		const onclose = vi.fn();
		const { container } = render(FilterSheet, { open: true, onclose, children: body });
		await fireEvent.click(container.querySelector('.fixed.inset-0')!);
		expect(onclose).toHaveBeenCalledTimes(1);
	});

	it('renders nothing while closed', () => {
		render(FilterSheet, { open: false, children: body });
		expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
	});

	it('ignores keys other than Escape while open', () => {
		const onclose = vi.fn();
		render(FilterSheet, { open: true, onclose, children: body });
		fireEvent.keyDown(window, { key: 'Enter' });
		expect(onclose).not.toHaveBeenCalled();
	});

	it('does not close via Escape while the sheet is already closed', () => {
		const onclose = vi.fn();
		render(FilterSheet, { open: false, onclose, children: body });
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).not.toHaveBeenCalled();
	});
});