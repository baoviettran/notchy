import { describe, it, expect, vi } from 'vitest';
import { invokeMutation } from '$lib/native/mutation-intent';

describe('durable mutation intents', () => {
	it('reuses an intent after a lost response, even after reloading its owner', async () => {
		const storage = new Map<string, string>();
		const store = { get length() { return storage.size; }, key: (n: number) => [...storage.keys()][n] ?? null, getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } };
		const ids: string[] = [];
		const call = vi.fn(async (_: string, args: Record<string, unknown>) => { ids.push(args.operationId as string); if (ids.length === 1) throw new Error('response lost'); return 'tx1'; });
		await expect(invokeMutation(call, 'transaction_create', { input: { amount: 50000 } }, undefined, store)).rejects.toThrow('response lost');
		expect(await invokeMutation(call, 'transaction_create', { input: { amount: 50000 } }, undefined, store)).toBe('tx1');
		expect(ids[0]).toBe(ids[1]);
		await invokeMutation(call, 'transaction_create', { input: { amount: 50000 } }, undefined, store);
		expect(ids[2]).not.toBe(ids[1]);
	});
	it('sends an explicit operation id unchanged', async () => {
		const call = vi.fn(async () => 'ok');
		await invokeMutation(call, 'transaction_create', {}, { operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
		expect(call).toHaveBeenCalledWith('transaction_create', { operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
	});
});

it('does not let a late completion erase a newer pending intent', async () => {
	const map = new Map<string, string>();
	const store = { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
	const calls: { id: string; resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
	const call = vi.fn((_cmd: string, args: Record<string, unknown>) => new Promise<string>((resolve, reject) => calls.push({ id: args.operationId as string, resolve, reject })));
	const a = invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store);
	await vi.waitFor(() => expect(calls).toHaveLength(1));
	const b = invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store);
	await vi.waitFor(() => expect(calls).toHaveLength(2));
	expect(calls[0].id).toBe(calls[1].id);
	calls[0].resolve('old'); await a;
	const c = invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store).catch(e => e);
	await vi.waitFor(() => expect(calls).toHaveLength(3));
	calls[1].resolve('old'); await b;
	calls[2].reject(new Error('lost')); await c;
	const retry = invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store);
	await vi.waitFor(() => expect(calls).toHaveLength(4));
	calls[3].resolve('new'); await retry;
	expect(calls[3].id).toBe(calls[2].id);
	expect(map.size).toBe(0);
});
it('requires a decision before reusing an unresolved save in a new interaction', async () => {
	const map = new Map<string, string>();
	const store = { get length() { return map.size; }, key: (n: number) => [...map.keys()][n] ?? null, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
	const call = vi.fn(async () => { throw new Error('lost response'); });
	await expect(invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store)).rejects.toThrow('lost response');
	const decide = vi.fn(async () => false);
	await expect(invokeMutation(call, 'transaction_create', { amount: 100 }, undefined, store, decide)).rejects.toMatchObject({ code: 'pending_save_unresolved' });
	expect(decide).toHaveBeenCalledOnce();
	expect(call).toHaveBeenCalledTimes(1);
	expect(map.size).toBe(1);
});
it('keeps a local pending-save error local when it reaches the native boundary', async () => {
	const { AppError } = await import('$lib/errors');
	const { toAppError } = await import('$lib/native/to-app-error');
	const { mapError } = await import('$lib/utils/errors');
	const original = new AppError('pending_save_unresolved');
	expect(toAppError(original)).toBe(original);
	expect(mapError(original)).toContain('Save paused');
});
