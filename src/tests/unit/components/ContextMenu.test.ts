// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';
import { snip } from '../helpers/snippet';

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
});
