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
	private queue: ToastItem[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private deadline = 0;

	private arm(duration: number): void {
		this.clearTimer();
		this.deadline = Date.now() + duration;
		const id = this.current?.id;
		this.timer = setTimeout(() => {
			if (this.current?.id === id) { this.current = null; this.promote(); }
		}, duration);
	}

	private clearTimer(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}

	// A live action toast is a safety net (undo). Informational toasts must not
	// evict it — they queue and surface when the slot frees. An action toast
	// always takes the slot: last deliberate destructive action wins.
	show(message: string, opts?: { action?: string; onaction?: () => void; duration?: number }) {
		const item: ToastItem = { id: ++nextId, message, ...opts };
		if (item.action) {
			this.queue = [];
			this.current = item;
			this.arm(opts?.duration ?? 3000);
			return;
		}
		if (this.current?.action) {
			// Informational toasts replace each other even while queued: only the
			// latest status matters once the action toast frees the slot.
			this.queue = [item];
			return;
		}
		this.current = item;
		this.arm(opts?.duration ?? 3000);
	}

	private promote(): void {
		const next = this.queue.shift();
		if (!next) return;
		this.current = next;
		this.arm(next.duration ?? 3000);
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
		this.promote();
	}
}

export const toast = new ToastBus();
