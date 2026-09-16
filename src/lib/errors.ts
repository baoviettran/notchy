import type { ErrorCode } from '$lib/native/contracts.generated';

export type ErrorParams = Record<string, string | number>;

/**
 * Typed backend error. Repo/domain layers throw an AppError carrying a stable
 * `code` (plus optional interpolation params); the catch boundary resolves the
 * code to a localized string via {@link mapError}. The repo layer stays
 * locale-agnostic — only the code/params travel up the call stack.
 */
export class AppError extends Error {
	readonly code: string;
	readonly params: ErrorParams;
	constructor(code: string, params: ErrorParams = {}) {
		super(code); // message is the code (for dev debugging / logging)
		this.name = 'AppError';
		this.code = code;
		this.params = params;
	}
}

/**
 * Marker for an error that came from the Rust boundary rather than the browser
 * layer. The two code namespaces overlap — `database_corrupt` exists on both
 * sides — so dispatch must key on origin, not on the code string. A rule like
 * `code in RUST_ERRORS ? rustTable[code] : switch(code)` would silently route
 * a browser-originated `database_corrupt` through the Rust table.
 */
export class NativeAppError extends AppError {
	declare readonly code: ErrorCode;
	constructor(code: ErrorCode, params: ErrorParams = {}) {
		super(code, params);
		this.name = 'NativeAppError';
	}
}
