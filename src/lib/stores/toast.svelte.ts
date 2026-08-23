export interface ToastItem {
	id: number;
	message: string;
	action?: string;
	onaction?: () => void;
	duration?: number;
}

let nextId = 0;

export class ToastBus {
	current = $state<ToastItem | null>(null);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline = 0;

	private arm(duration: number): void {
		this.clearTimer();
		this.deadline = Date.now() + duration;
		const id = this.current?.id;
		this.timer = setTimeout(() => { if (this.current?.id === id) this.current = null; }, duration);
	}

	private clearTimer(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}

	show(message: string, opts?: { action?: string; onaction?: () => void; duration?: number }) {
		this.current = { id: ++nextId, message, ...opts };
		this.arm(opts?.duration ?? 3000);
	}

	// Hover/focus pauses the countdown so the undo affordance cannot expire
	// under the pointer or while a keyboard user is reaching for it.
	pause(): void {
		if (this.timer === undefined || !this.current) return;
		this.arm(Math.max(this.deadline - Date.now(), 1000));
		this.clearTimer();
	}

	resume(): void {
		if (this.timer !== undefined || !this.current) return;
		this.arm(Math.max(this.deadline - Date.now(), 1000));
	}

	dismiss() {
		this.clearTimer();
		this.current = null;
	}
}

export const toast = new ToastBus();
