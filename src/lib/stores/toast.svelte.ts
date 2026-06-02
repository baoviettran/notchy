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

	show(message: string, opts?: { action?: string; onaction?: () => void; duration?: number }) {
		this.current = { id: ++nextId, message, ...opts };
		const duration = opts?.duration ?? 3000;
		const id = nextId;
		setTimeout(() => { if (this.current?.id === id) this.current = null; }, duration);
	}

	dismiss() {
		this.current = null;
	}
}

export const toast = new ToastBus();
