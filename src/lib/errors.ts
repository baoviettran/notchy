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
