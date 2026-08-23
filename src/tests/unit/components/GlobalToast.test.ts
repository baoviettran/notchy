// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import GlobalToast from '$lib/components/primitives/GlobalToast.svelte';
import { toast } from '$lib/stores/toast.svelte';

afterEach(() => toast.dismiss());

describe('GlobalToast', () => {
	it('exposes a polite status live region so delete/undo is announced', () => {
		toast.show('Transaction deleted.', { action: 'UNDO', duration: 5000 });
		render(GlobalToast);
		const region = screen.getByRole('status');
		expect(region).toHaveAttribute('aria-live', 'polite');
		expect(region).toHaveTextContent('Transaction deleted.');
		expect(region).toHaveTextContent('UNDO');
	});

	it('keeps the live region mounted even when no toast is active', () => {
		render(GlobalToast);
		expect(screen.getByRole('status')).toBeInTheDocument();
	});

	it('names the ✕ dismiss button (currently a bare glyph)', () => {
		toast.show('Saved.');
		render(GlobalToast);
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});
});
