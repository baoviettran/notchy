import { NativeAppError } from '$lib/errors';
import type { ErrorCode } from '$lib/native/contracts.generated';

/**
 * Convert a Rust `{code, meta}` rejection into a NativeAppError.
 *
 * `meta` is a `BTreeMap<String, String>` on the Rust side, which is already
 * the `ErrorParams` shape the message functions take. Anything that is not a
 * well-formed envelope is returned untouched, so a transport failure still
 * surfaces as itself rather than being mislabelled a domain error.
 */
export function toAppError(error: unknown): unknown {
	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof (error as { code: unknown }).code === 'string'
	) {
		const envelope = error as { code: ErrorCode; meta?: Record<string, string> };
		return new NativeAppError(envelope.code, envelope.meta ?? {});
	}
	return error;
}
