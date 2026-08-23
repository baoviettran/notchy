// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';

/**
 * The transaction page adds a confirmation step before doDelete.
 * This test verifies the ConfirmDialog integration pattern:
 * - Dialog is hidden initially
 * - Setting open=true shows the dialog with correct title/message
 * - Confirming calls the callback
 * - Cancelling hides the dialog without calling the callback
 */
describe('Transaction delete confirmation pattern', () => {
	it('dialog is hidden initially', () => {
		render(ConfirmDialog, { open: false, title: 'Delete transaction?', message: 'This action cannot be undone.' });
		expect(screen.queryByText('Delete transaction?')).not.toBeInTheDocument();
	});

	it('shows confirm title and body when open', () => {
		render(ConfirmDialog, { open: true, title: 'Delete transaction?', message: 'This action cannot be undone.' });
		expect(screen.getByText('Delete transaction?')).toBeInTheDocument();
		expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
	});

	it('calls onconfirm when confirmed', async () => {
		const onconfirm = vi.fn();
		render(ConfirmDialog, { open: true, title: 'Delete transaction?', message: 'This action cannot be undone.', onconfirm });
		await fireEvent.click(screen.getByText('Delete'));
		expect(onconfirm).toHaveBeenCalledOnce();
	});

	it('does not call onconfirm when cancelled', async () => {
		const onconfirm = vi.fn();
		render(ConfirmDialog, { open: true, title: 'Delete transaction?', message: 'This action cannot be undone.', onconfirm });
		await fireEvent.click(screen.getByText('Cancel'));
		expect(onconfirm).not.toHaveBeenCalled();
	});

	it('renders as accessible dialog', () => {
		render(ConfirmDialog, { open: true, title: 'Delete transaction?', message: 'This action cannot be undone.' });
		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(dialog).toHaveAttribute('aria-label', 'Delete transaction?');
	});
});
