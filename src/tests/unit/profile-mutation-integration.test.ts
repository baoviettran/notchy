import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NativeCall } from '$lib/native/invoke';
import { createSessionInvoker } from '$lib/profiles/session';

afterEach(() => vi.unstubAllGlobals());
function storage() {
 const map = new Map<string, string>();
 vi.stubGlobal('localStorage', { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } });
 return map;
}
describe('profile-bound durable mutations', () => {
 it('retains a lost-response intent across generations and isolates another profile', async () => {
  storage();
  const calls: Record<string, unknown>[] = [];
  const raw = vi.fn(async <T>(_cmd: string, args?: Record<string, unknown>) => { calls.push(args!); if (calls.length === 1) throw new Error('lost response'); return 'saved' as T; }) as NativeCall;
  const args = { input: { amount: 100 } };
  await expect(createSessionInvoker({ profileId: 'a', generation: '1' }, raw)('transaction_create', args)).rejects.toThrow('lost response');
  await createSessionInvoker({ profileId: 'b', generation: '2' }, raw)('transaction_create', args);
  await createSessionInvoker({ profileId: 'a', generation: '3' }, raw)('transaction_create', args);
  expect(calls[0].operationId).toBeTruthy();
  expect(calls[2].operationId).toBe(calls[0].operationId);
  expect(calls[1].operationId).not.toBe(calls[0].operationId);
  expect(calls[2].session).toEqual({ profileId: 'a', generation: '3' });
 });
 it('passes explicit mutation options through the bound session', async () => {
  storage();
  const raw = vi.fn(async <T>() => 'saved' as T) as NativeCall;
  const invoke = createSessionInvoker({ profileId: 'a', generation: '1' }, raw);
  await invoke('transaction_create', {}, { operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  expect(raw).toHaveBeenCalledWith('transaction_create', { session: { profileId: 'a', generation: '1' }, operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
 });
});
