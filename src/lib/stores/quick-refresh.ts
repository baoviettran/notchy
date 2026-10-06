import type { listen } from '@tauri-apps/api/event';

type Listen = typeof listen;

/**
 * Register a `transaction:saved` listener that refetches store data.
 *
 * Dependency-injected so the wiring is unit-testable without Tauri/jsdom:
 * the layout passes the real `listen` and an async `refetch` (which calls the
 * relevant stores' `load()`). Returns an `unlisten` for cleanup.
 */
export async function attachTransactionSavedListener(
  listen: Listen,
  refetch: () => Promise<void>
): Promise<() => void> {
  return listen('transaction:saved', async () => {
    await refetch();
  });
}

/**
 * Tell every window that transactions changed.
 *
 * Each Tauri webview has its own JS context and its own stores, so a write in
 * one window is invisible to another until this signal crosses the boundary.
 * Under Tauri that is an `emit` the layout's `attachTransactionSavedListener`
 * picks up; in the browser build it is a window event (and the caller refreshes
 * its own list directly, since nothing listens there).
 *
 * Best-effort by design: a caller has already committed its writes by the time
 * it calls this, so a failure here must never surface as an error.
 */
export async function emitTransactionsChanged(): Promise<void> {
	try {
		if (typeof window !== 'undefined' && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
			const { emit } = await import('@tauri-apps/api/event');
			await emit('transaction:saved', {});
		} else {
			window.dispatchEvent(new Event('transaction:saved'));
		}
	} catch {
		/* non-fatal: the calling window refreshes its own stores regardless */
	}
}
