// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Modal from '$lib/components/primitives/Modal.svelte';
import { snip } from '../helpers/snippet';
import ModalProbe from './helpers/ModalProbe.svelte';

describe('Modal', () => {
	it('does not render when open=false', () => {
		render(Modal, { open: false, children: snip('Content') });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders dialog with title when open=true', () => {
		render(Modal, { open: true, title: 'Test Title', children: snip('Content') });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Test Title')).toBeInTheDocument();
	});

	it('renders close button when title is provided', () => {
		render(Modal, { open: true, title: 'Titled', children: snip('Body') });
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	it('omits title section when title is empty', () => {
		render(Modal, { open: true, title: '', children: snip('Body') });
		expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
	});

	it('closes on Escape key', async () => {
		render(Modal, { open: true, title: 'Test', children: snip('Body') });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('moves focus into the dialog on open and restores it on close', async () => {
		render(ModalProbe, { open: false });
		const trigger = screen.getByRole('button', { name: 'Open' });
		trigger.focus();
		await fireEvent.click(trigger);
		const dialog = screen.getByRole('dialog');
		// children[0] is the backdrop, children[1] is the panel.
		const panel = dialog.children[1] as HTMLElement;
		expect(panel.contains(document.activeElement)).toBe(true);
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		expect(trigger).toHaveFocus();
	});

	it('traps Tab within the dialog, wrapping at both ends', async () => {
		render(ModalProbe, { open: true });
		const dialog = screen.getByRole('dialog');
		const panel = dialog.children[1] as HTMLElement;
		const first = screen.getByRole('button', { name: 'First' });
		const last = screen.getByRole('button', { name: 'Second' });
		first.focus();
		await fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
		expect(last).toHaveFocus();
		await fireEvent.keyDown(panel, { key: 'Tab' });
		expect(first).toHaveFocus();
	});

	it('associates the dialog with its title via aria-labelledby', () => {
		render(Modal, { open: true, title: 'Titled Dialog', children: snip('Body') });
		const dialog = screen.getByRole('dialog');
		const title = screen.getByText('Titled Dialog');
		expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
		expect(title.id).not.toBe('');
	});
});
