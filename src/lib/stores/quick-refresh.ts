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
