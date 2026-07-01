import { describe, it, expect, vi } from 'vitest';
import { attachTransactionSavedListener } from '$lib/stores/quick-refresh';

describe('attachTransactionSavedListener', () => {
  it('calls refetch when a transaction:saved event arrives', async () => {
    let registered: ((e: { payload: unknown }) => void) | null = null;
    const off = vi.fn();
    const fakeListen = vi.fn(
      async (_channel: string, cb: (e: { payload: unknown }) => void) => {
        registered = cb;
        return off;
      }
    );
    const refetch = vi.fn(async () => {});

    const unlisten = await attachTransactionSavedListener(
      fakeListen as unknown as typeof import('@tauri-apps/api/event').listen,
      refetch
    );

    // It registered on the correct channel.
    expect(fakeListen).toHaveBeenCalledWith('transaction:saved', expect.any(Function));

    // Simulate the quick-add window emitting the event.
    await registered!({ payload: { accountId: 'a1' } });

    expect(refetch).toHaveBeenCalledTimes(1);

    // unlisten returns the underlying off().
    unlisten();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('does not call refetch before any event', async () => {
    const fakeListen = vi.fn(async () => vi.fn());
    const refetch = vi.fn(async () => {});
    await attachTransactionSavedListener(
      fakeListen as unknown as typeof import('@tauri-apps/api/event').listen,
      refetch
    );
    expect(refetch).not.toHaveBeenCalled();
  });
});
