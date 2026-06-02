import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToastBus } from '$lib/stores/toast.svelte';

let bus: InstanceType<typeof ToastBus>;

beforeEach(() => {
	vi.useFakeTimers();
	bus = new ToastBus();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('ToastBus', () => {
	it('starts with null current', () => {
		expect(bus.current).toBeNull();
	});

	it('show sets current with message', () => {
		bus.show('Hello');
		expect(bus.current).not.toBeNull();
		expect(bus.current!.message).toBe('Hello');
	});

	it('show auto-increments id', () => {
		bus.show('First');
		const firstId = bus.current!.id;
		bus.show('Second');
		expect(bus.current!.id).toBeGreaterThan(firstId);
	});

	it('show passes through options', () => {
		bus.show('Hello', { action: 'UNDO', duration: 5000 });
		expect(bus.current!.action).toBe('UNDO');
		expect(bus.current!.duration).toBe(5000);
	});

	it('dismiss sets current to null', () => {
		bus.show('Hello');
		bus.dismiss();
		expect(bus.current).toBeNull();
	});

	it('auto-dismisses after default duration (3000ms)', () => {
		bus.show('Hello');
		expect(bus.current).not.toBeNull();

		vi.advanceTimersByTime(2999);
		expect(bus.current).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(bus.current).toBeNull();
	});

	it('auto-dismisses after custom duration', () => {
		bus.show('Hello', { duration: 5000 });
		expect(bus.current).not.toBeNull();

		vi.advanceTimersByTime(4999);
		expect(bus.current).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(bus.current).toBeNull();
	});

	it('does not auto-dismiss if a newer toast replaced it', () => {
		bus.show('First', { duration: 3000 });
		vi.advanceTimersByTime(1000);
		bus.show('Second', { duration: 3000 });

		// First toast's timer fires but should not clear the second toast
		vi.advanceTimersByTime(2000);
		expect(bus.current).not.toBeNull();
		expect(bus.current!.message).toBe('Second');
	});
});
