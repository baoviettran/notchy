import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToastBus } from '$lib/stores/toast.svelte';

afterEach(() => vi.useRealTimers());

describe('ToastBus', () => {
	it('expires after the given duration', () => {
		vi.useFakeTimers();
		const bus = new ToastBus();
		bus.show('Saved.', { duration: 3000 });
		expect(bus.current).not.toBeNull();
		vi.advanceTimersByTime(3000);
		expect(bus.current).toBeNull();
	});

	it('pauses the countdown while hovered or focused so undo cannot expire under the pointer', () => {
		vi.useFakeTimers();
		const bus = new ToastBus();
		bus.show('Deleted.', { action: 'UNDO', duration: 5000 });
		vi.advanceTimersByTime(4000);
		bus.pause();
		vi.advanceTimersByTime(10_000);
		expect(bus.current).not.toBeNull();
	});

	it('resumes with the remaining time and keeps at least one second', () => {
		vi.useFakeTimers();
		const bus = new ToastBus();
		bus.show('Deleted.', { action: 'UNDO', duration: 5000 });
		vi.advanceTimersByTime(4000);
		bus.pause();
		bus.resume();
		vi.advanceTimersByTime(999);
		expect(bus.current).not.toBeNull();
		vi.advanceTimersByTime(2);
		expect(bus.current).toBeNull();
	});

	it('replaces an older toast and restarts its timer', () => {
		vi.useFakeTimers();
		const bus = new ToastBus();
		bus.show('First.', { duration: 1000 });
		bus.show('Second.', { duration: 3000 });
		vi.advanceTimersByTime(1000);
		expect(bus.current?.message).toBe('Second.');
		vi.advanceTimersByTime(2000);
		expect(bus.current).toBeNull();
	});
});
