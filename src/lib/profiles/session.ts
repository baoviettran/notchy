import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { invokeWith, type NativeCall } from '$lib/native/invoke';
import type { MutationOptions } from '$lib/native/mutation-intent';
import { toAppError } from '$lib/native/to-app-error';
import type { ProfileSession } from './types';

export type SessionInvoker = <T>(command: string, args?: Record<string, unknown>, options?: MutationOptions) => Promise<T>;

export function assertCurrentSession(expected: ProfileSession, actual: ProfileSession | null): void {
	if (!actual || expected.profileId !== actual.profileId || expected.generation !== actual.generation) {
		throw new Error('profile session expired');
	}
}

export function createSessionInvoker(
	session: ProfileSession,
	raw: NativeCall = tauriInvoke,
	current?: () => ProfileSession | null,
): SessionInvoker {
	const bound = Object.freeze({ ...session });
	return async <T>(command: string, args?: Record<string, unknown>, options?: MutationOptions): Promise<T> => {
		if (current) assertCurrentSession(bound, current());
		try {
			const result = await invokeWith<T>(raw, command, { ...args, session: bound }, options);
			if (current) assertCurrentSession(bound, current());
			return result;
		} catch (error) {
			throw toAppError(error);
		}
	};
}
