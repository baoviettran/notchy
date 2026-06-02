// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Modal from '$lib/components/primitives/Modal.svelte';

describe('Modal', () => {
	it('does not render when open=false', () => {
		render(Modal, { open: false, children: () => 'Content' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders dialog with title when open=true', () => {
		render(Modal, { open: true, title: 'Test Title', children: () => 'Content' });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByText('Test Title')).toBeInTheDocument();
	});

	it('renders close button when title is provided', () => {
		render(Modal, { open: true, title: 'Titled', children: () => 'Body' });
		expect(screen.getByText('✕')).toBeInTheDocument();
	});

	it('omits title section when title is empty', () => {
		render(Modal, { open: true, title: '', children: () => 'Body' });
		expect(screen.queryByText('✕')).not.toBeInTheDocument();
	});

	it('closes on Escape key', async () => {
		render(Modal, { open: true, title: 'Test', children: () => 'Body' });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
