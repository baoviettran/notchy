// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
import ConfirmDialogChildrenProbe from './helpers/ConfirmDialogChildrenProbe.svelte';
import ConfirmDialogReopenProbe from './helpers/ConfirmDialogReopenProbe.svelte';
import ConfirmDialogConfirmTxProbe from './helpers/ConfirmDialogConfirmTxProbe.svelte';
import ConfirmDialogConfirmBackupProbe from './helpers/ConfirmDialogConfirmBackupProbe.svelte';

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

	it('renders optional children snippet content inside the dialog', () => {
		// The categories delete flow passes a merge-target <Select> through the
		// children snippet when the tag is referenced by transactions.
		render(ConfirmDialogChildrenProbe, { open: true });
		const extra = screen.getByTestId('merge-target');
		expect(screen.getByRole('dialog').contains(extra)).toBe(true);
	});

	it('invokes onclose when closed via Cancel', async () => {
		const onclose = vi.fn();
		render(ConfirmDialog, { open: true, title: 'T', message: 'M', onclose });
		await fireEvent.click(screen.getByText('Cancel'));
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('invokes onclose when closed via Escape', async () => {
		const onclose = vi.fn();
		render(ConfirmDialog, { open: true, title: 'T', message: 'M', onclose });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('invokes onclose when closed via the backdrop', async () => {
		const onclose = vi.fn();
		const { container } = render(ConfirmDialog, { open: true, title: 'T', message: 'M', onclose });
		await fireEvent.click(container.querySelector('[role="presentation"]')!);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('does not invoke onclose when the confirm button is clicked', async () => {
		// Confirm has its own onconfirm callback; onclose is only for internal
		// close paths (Cancel, Esc, backdrop).
		const onclose = vi.fn();
		const onconfirm = vi.fn();
		render(ConfirmDialog, { open: true, title: 'T', message: 'M', onclose, onconfirm, confirmLabel: 'OK' });
		await fireEvent.click(screen.getByText('OK'));
		expect(onconfirm).toHaveBeenCalledOnce();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('reopens after an internal close when the parent chooses a new target', async () => {
		// Regression guard: with a one-way `open={target !== null}` prop, an
		// internal close must reach the parent (onclose), or the parent's
		// expression never changes again and the dialog stays shut forever.
		const onclose = vi.fn();
		render(ConfirmDialogReopenProbe, { onclose });
		await fireEvent.click(screen.getByTestId('open-a'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Tag A')).toBeInTheDocument();
		await fireEvent.click(screen.getByText('Cancel'));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		expect(onclose).toHaveBeenCalledOnce();
		await fireEvent.click(screen.getByTestId('open-b'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Tag B')).toBeInTheDocument();
	});

	it('reopens after CONFIRM when the parent chooses a new target (transactions list shape)', async () => {
		// Regression guard: the confirm handler must reset the page's trigger
		// state too — with a one-way open prop, a confirm handler that only
		// clears the pending target leaves the open expression stuck at true,
		// and the next delete click never reopens the dialog.
		render(ConfirmDialogConfirmTxProbe);
		await fireEvent.click(screen.getByTestId('del-1'));
		expect(screen.getByText('Tx 1')).toBeInTheDocument();
		await fireEvent.click(screen.getByText('OK'));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		await fireEvent.click(screen.getByTestId('del-2'));
		expect(screen.getByText('Tx 2')).toBeInTheDocument();
	});

	it('reopens after CONFIRM when the picker was cancelled (backup shape)', async () => {
		// Regression guard: importDb's early return (native picker cancelled)
		// must still clear confirmImport, or the Import button is dead until
		// reload.
		render(ConfirmDialogConfirmBackupProbe);
		await fireEvent.click(screen.getByTestId('import-btn'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		// Confirm; the "picker" is cancelled (no path picked).
		await fireEvent.click(screen.getByText('Confirm'));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
		// Import must be alive again after the cancelled picker.
		await fireEvent.click(screen.getByTestId('import-btn'));
		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});
});
