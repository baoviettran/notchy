import { describe, it, expect } from 'vitest';
import { toast } from '$lib/stores/toast.svelte';

/**
 * Goal status-change undo contract — mirrors the transaction undo pattern.
 * toast.show accepts an onaction callback that fires when the user taps UNDO.
 */

describe('goal status undo contract', () => {
	it('toast.show accepts an onaction callback (undo contract)', () => {
		toast.show('Goal completed.', { action: 'UNDO', duration: 5000, onaction: () => {} });
		expect(toast.current).toBeTruthy();
		expect(toast.current!.message).toBe('Goal completed.');
		expect(toast.current!.action).toBe('UNDO');
		expect(typeof toast.current!.onaction).toBe('function');
	});

	it('onaction callback fires when invoked', () => {
		let called = false;
		toast.show('Goal abandoned.', { action: 'UNDO', onaction: () => { called = true; } });
		toast.current!.onaction!();
		expect(called).toBe(true);
	});

	it('toast replaces any existing toast (no stacking)', () => {
		toast.show('First message', { action: 'UNDO', onaction: () => {} });
		toast.show('Second message');
		expect(toast.current!.message).toBe('Second message');
	});
});
