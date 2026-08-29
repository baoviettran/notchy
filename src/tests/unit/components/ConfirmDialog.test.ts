// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
	it('renders title and message when open', () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'This cannot be undone.' });
		expect(screen.getByText('Delete?')).toBeInTheDocument();
		expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
	});

	it('does not render when closed', () => {
		render(ConfirmDialog, { open: false, title: 'Delete?', message: 'Sure?' });
		expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
	});

	it('calls onconfirm when confirm button clicked', async () => {
		const onconfirm = vi.fn();
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?', onconfirm });
		await fireEvent.click(screen.getByText('Delete'));
		expect(onconfirm).toHaveBeenCalledOnce();
	});

	it('closes dialog BEFORE firing onconfirm callback', async () => {
		// Prove-it test: a regression to the old ordering (onconfirm(); open = false)
		// would pass all other tests but break components that remove the trigger
		// element inside the callback (focus trap would try to restore focus to a
		// destroyed node).
		const onconfirm = vi.fn(() => {
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		});
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?', onconfirm });
		await fireEvent.click(screen.getByText('Delete'));
		await vi.waitFor(() => expect(onconfirm).toHaveBeenCalledOnce());
	});

	it('closes when Cancel is clicked', async () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		await fireEvent.click(screen.getByText('Cancel'));
		expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
	});

	it('shows primary variant by default (danger is opt-in)', () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		expect(screen.getByText('Delete').className).toContain('bg-phosphor');
	});

	it('shows the danger variant when danger=true, with ink text for AA contrast', () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?', danger: true });
		const className = screen.getByText('Delete').className;
		expect(className).toContain('bg-debit');
		expect(className).toContain('text-ink');
	});

	it('uses custom confirmLabel', () => {
		render(ConfirmDialog, { open: true, title: 'Reset?', message: 'Sure?', confirmLabel: 'Reset' });
		expect(screen.getByText('Reset')).toBeInTheDocument();
	});

	it('renders as an accessible dialog (role=dialog, aria-modal) when open', () => {
		// Must be announced as a dialog to assistive tech, like Modal.svelte.
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		const dialog = screen.getByRole('dialog');
		expect(dialog).toBeInTheDocument();
		expect(dialog.getAttribute('aria-modal')).toBe('true');
	});

	it('moves focus into the dialog on open', () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?', confirmLabel: 'Delete' });
		// First focusable control is the Cancel button.
		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
	});

	it('closes on Escape', async () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
