// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
import { snip } from '../helpers/snippet';
import ContextMenuProbe from './helpers/ContextMenuProbe.svelte';

describe('ContextMenu', () => {
	it('renders a trigger button', () => {
		render(ContextMenu, { children: snip('Item') });
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('hides the menu by default', () => {
		render(ContextMenu, { children: snip('Item') });
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('opens the menu on trigger click', async () => {
		render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByRole('menu')).toBeInTheDocument();
	});

	it('closes the menu on Escape', async () => {
		render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByRole('menu')).toBeInTheDocument();
		// Escape on the menu element
		await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('closes the menu on backdrop click', async () => {
		const { container } = render(ContextMenu, { children: snip('Item') });
		await fireEvent.click(screen.getByRole('button'));
		expect(screen.getByRole('menu')).toBeInTheDocument();
		const backdrop = container.querySelector('[data-testid="menu-backdrop"]');
		expect(backdrop).toBeTruthy();
		await fireEvent.click(backdrop!);
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('uses the provided aria-label on the trigger', () => {
		render(ContextMenu, { label: 'Row actions', children: snip('Item') });
		expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Row actions');
	});

	it('moves focus to the first item when the menu opens', async () => {
		render(ContextMenuProbe);
		await fireEvent.click(screen.getByRole('button'));
		const items = screen.getAllByRole('menuitem');
		await vi.waitFor(() => expect(items[0]).toHaveFocus());
	});

	it('navigates items with arrow keys, wrapping at both ends', async () => {
		render(ContextMenuProbe);
		await fireEvent.click(screen.getByRole('button'));
		const [a, b, c] = screen.getAllByRole('menuitem');
		await fireEvent.keyDown(a, { key: 'ArrowDown' });
		expect(b).toHaveFocus();
		await fireEvent.keyDown(b, { key: 'ArrowDown' });
		expect(c).toHaveFocus();
		await fireEvent.keyDown(c, { key: 'ArrowDown' });
		expect(a).toHaveFocus();
		await fireEvent.keyDown(a, { key: 'ArrowUp' });
		expect(c).toHaveFocus();
	});

	it('returns focus to the trigger when the menu closes', async () => {
		render(ContextMenuProbe);
		const trigger = screen.getByRole('button');
		trigger.focus();
		await fireEvent.click(trigger);
		await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		expect(trigger).toHaveFocus();
	});

	it('exposes aria-haspopup on the trigger', () => {
		render(ContextMenu, { label: 'Row actions', children: snip('Item') });
		expect(screen.getByRole('button')).toHaveAttribute('aria-haspopup', 'menu');
	});
});
