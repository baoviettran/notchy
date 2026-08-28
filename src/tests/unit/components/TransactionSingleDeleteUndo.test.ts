// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { toast } from '$lib/stores/toast.svelte';

/**
 * Regression test: single delete must show an undo toast, matching the
 * bulk-delete pattern. Previously single delete was fire-and-forget —
 * the transaction vanished with no safety net.
 *
 * We test the toast contract directly since the transactions page has
 * deep store dependencies that make full rendering impractical in unit.
 * The E2E suite covers the full delete→undo flow end-to-end.
 */

describe('Single transaction delete undo', () => {
	beforeEach(() => {
		toast.dismiss();
	});

	it('toast.show accepts an onaction callback (undo contract)', () => {
		const onaction = vi.fn();
		toast.show('Transaction deleted.', {
			action: 'UNDO',
			onaction,
			duration: 5000
		});

		expect(toast.current).not.toBeNull();
		expect(toast.current!.message).toBe('Transaction deleted.');
		expect(toast.current!.action).toBe('UNDO');
		expect(typeof toast.current!.onaction).toBe('function');
	});

	it('onaction callback fires when invoked', async () => {
		const onaction = vi.fn();
		toast.show('Deleted.', { action: 'UNDO', onaction });

		// Simulate the user clicking UNDO
		toast.current!.onaction!();

		expect(onaction).toHaveBeenCalledOnce();
	});

	it('toast replaces any existing toast (no stacking)', () => {
		toast.show('First message');
		expect(toast.current!.message).toBe('First message');

		toast.show('Transaction deleted.', { action: 'UNDO', onaction: vi.fn() });
		expect(toast.current!.message).toBe('Transaction deleted.');
		expect(toast.current!.action).toBe('UNDO');
	});
});
