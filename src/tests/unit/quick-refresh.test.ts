// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  attachTransactionSavedListener,
  emitTransactionsChanged
} from '$lib/stores/quick-refresh';

// The emit helper dynamically imports this under Tauri; the mock lets the
// Tauri-path cases assert the call without a real webview.
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => {}) }));

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

describe('emitTransactionsChanged', () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('dispatches a window event in a browser context', async () => {
    // No __TAURI_INTERNALS__ on window → the window/CustomEvent path.
    expect(
      (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    ).toBeUndefined();
    const spy = vi.spyOn(window, 'dispatchEvent');

    await emitTransactionsChanged();

    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][0];
    expect(event).toBeInstanceOf(Event);
    expect((event as Event).type).toBe('transaction:saved');
    spy.mockRestore();
  });

  it('emits the Tauri event under Tauri', async () => {
    // __TAURI_INTERNALS__ present → the dynamic import + emit path.
    const { emit } = vi.mocked(await import('@tauri-apps/api/event'), true);
    vi.mocked(emit).mockClear();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    await emitTransactionsChanged();

    expect(vi.mocked(emit)).toHaveBeenCalledWith('transaction:saved', {});
  });

  it('never throws when the emit itself fails', async () => {
    // The signal is best-effort: a failed refresh must not turn a successful
    // post into a boot error.
    const { emit } = vi.mocked(await import('@tauri-apps/api/event'), true);
    vi.mocked(emit).mockRejectedValueOnce(new Error('emit failed'));
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    await expect(emitTransactionsChanged()).resolves.toBeUndefined();
  });
});
