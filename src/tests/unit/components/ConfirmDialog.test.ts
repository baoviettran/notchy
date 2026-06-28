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

	it('closes when Cancel is clicked', async () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		await fireEvent.click(screen.getByText('Cancel'));
		expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
	});

	it('shows danger variant button by default', () => {
		render(ConfirmDialog, { open: true, title: 'Delete?', message: 'Sure?' });
		expect(screen.getByText('Delete').className).toContain('bg-debit');
	});

	it('shows primary variant when danger=false', () => {
		render(ConfirmDialog, { open: true, title: 'Confirm?', message: 'Sure?', danger: false, confirmLabel: 'OK' });
		expect(screen.getByText('OK').className).toContain('bg-phosphor');
	});

	it('uses custom confirmLabel', () => {
		render(ConfirmDialog, { open: true, title: 'Reset?', message: 'Sure?', confirmLabel: 'Reset' });
		expect(screen.getByText('Reset')).toBeInTheDocument();
	});
});
