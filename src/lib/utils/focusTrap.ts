export const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function focusFirst(panelEl: HTMLElement | undefined): void {
	const first = panelEl?.querySelector<HTMLElement>(FOCUSABLE);
	(first ?? panelEl)?.focus();
}

// Per-dialog trap instance: remembers the trigger for focus restore, traps
// Tab within the panel, and returns the $effect cleanup that restores focus.
export function createFocusTrap() {
	let lastFocused: HTMLElement | null = null;
	return {
		// Handles the Tab key only; callers route Escape themselves.
		trap(e: KeyboardEvent, panelEl: HTMLElement | undefined) {
			if (e.key !== 'Tab') return;
			const focusables = Array.from(panelEl?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
				.filter((el) => {
					const style = getComputedStyle(el);
					return style.display !== 'none' && style.visibility !== 'hidden';
				});
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
		},
		// Focus-in: capture the trigger, focus the first focusable (or panel).
		// Call from inside a component-level $effect when the dialog is open;
		// the returned cleanup restores focus and is what $effect runs on close.
		enter(getPanel: () => HTMLElement | undefined): () => void {
			lastFocused = document.activeElement as HTMLElement | null;
			const panelEl = getPanel();
			focusFirst(panelEl);
			return () => { lastFocused?.focus?.(); lastFocused = null; };
		},
	};
}
