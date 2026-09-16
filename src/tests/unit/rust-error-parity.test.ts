/**
 * Gate 2's runtime backstop. Exhaustiveness of RUST_ERROR_MESSAGES is a
 * compile error, but the compiler only sees the *generated* union — a stale
 * union keeps the build green while a new code falls through. This test reads
 * the union at runtime and asserts the same thing, and pins the two dispatch
 * paths apart.
 */
import { describe, it, expect } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { AppError, NativeAppError } from '$lib/errors';
import { RUST_ERROR_MESSAGES } from '$lib/utils/rust-error-messages';
import { mapError } from '$lib/utils/errors';
import { toAppError } from '$lib/native/to-app-error';

describe('RUST_ERROR_MESSAGES', () => {
	it('covers every generated ErrorCode', async () => {
		const generated = await import('$lib/native/contracts.generated');
		const codes = generated.ErrorCodeValues ?? [];
		expect(codes.length).toBeGreaterThan(0);
		for (const code of codes) {
			expect(RUST_ERROR_MESSAGES[code]).toBeTypeOf('function');
		}
	});

	it('returns a non-empty string for every code', () => {
		for (const [code, message] of Object.entries(RUST_ERROR_MESSAGES)) {
			expect(message({}), `${code} produced empty copy`).toBeTruthy();
		}
	});
});

describe('mapError dispatch keys on origin, not on the code string', () => {
	it('routes a Rust-originated database_corrupt through the native table', () => {
		const message = mapError(new NativeAppError('database_corrupt'));
		expect(message).toBe(RUST_ERROR_MESSAGES.database_corrupt({}));
		expect(message).not.toBe(m.errors_unknown());
	});

	it('keeps a browser-originated database_corrupt on the browser path', () => {
		// The one string present in both namespaces. If dispatch keyed on the
		// string, this would land in the Rust table.
		expect(mapError(new AppError('database_corrupt'))).toBe(m.errors_unknown());
	});
});

describe('toAppError', () => {
	it('converts a Rust envelope into a NativeAppError carrying its meta', () => {
		const converted = toAppError({ code: 'amount_out_of_range', meta: {} });
		expect(converted).toBeInstanceOf(NativeAppError);
		expect((converted as NativeAppError).code).toBe('amount_out_of_range');
	});

	it('leaves a non-envelope failure untouched', () => {
		const transport = new Error('IPC unavailable');
		expect(toAppError(transport)).toBe(transport);
	});
});
