import { confirm } from '@tauri-apps/plugin-dialog';
import { AppError } from '$lib/errors';
import * as m from '$lib/paraglide/messages';
import { ulid } from '$lib/utils/id';

export interface MutationOptions { operationId?: string }
export function createMutationIntent(): { operationId: string } {
	return { operationId: ulid() };
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>;
type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	return JSON.stringify(value);
}
/** Retain only a SHA-256 fingerprint and ULID, never financial payloads. Pending
 * entries survive reload and are removed only after a definitive response. */
export async function invokeMutation<T>(call: Invoke, command: string, args: Record<string, unknown> = {}, options?: MutationOptions, store?: Store, decidePending?: () => Promise<boolean>): Promise<T> {
	if (options?.operationId) return await call(command, { ...args, operationId: options.operationId }) as T;
	const storage = store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
	// Profile identity survives reload; generation is only an execution guard.
	// Another profile must never inherit an unresolved financial intent.
	const session = args.session as { profileId?: string } | undefined;
	const fingerprintArgs = session ? { ...args, session: { profileId: session.profileId } } : args;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ command, args: fingerprintArgs })));
	const prefix = 'notchy.pending.v1.' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') + '.';
	// Each intent owns a distinct key. A late response may remove only its own
	// key, even when another webview has started a newer identical intent.
	const pending: string[] = [];
	if (storage) {
		for (let i = 0; i < storage.length; i++) {
			const candidate = storage.key(i);
			if (candidate?.startsWith(prefix)) pending.push(candidate);
		}
	}
	const key = pending.sort()[0] ?? prefix + ulid();
	if (pending.length) {
		const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
		const retryPrevious = decidePending ? await decidePending() : !native || await confirm(m.pending_save_description(), {
			title: m.pending_save_title(), okLabel: m.pending_save_retry(), cancelLabel: m.pending_save_keep_draft()
		});
		if (!retryPrevious) throw new AppError('pending_save_unresolved');
	}
	const operationId = storage?.getItem(key) ?? key.slice(prefix.length);
	// Fail before issuing a write if durable intent storage is unavailable under
	// Tauri. Node tests may use the explicit options or injected store.
	if (!storage && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) throw new Error('Pending operation storage unavailable');
	storage?.setItem(key, operationId);
	try {
		const result = await call(command, { ...args, operationId });
		storage?.removeItem(key);
		return result as T;
	} catch (error) {
		// Structured domain rejection is definitive; a transport failure is not.
		if (error && typeof error === 'object' && !(error instanceof Error) && 'code' in error && error.code !== 'profile_session_expired') storage?.removeItem(key);
		throw error;
	}
}
