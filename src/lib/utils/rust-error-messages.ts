/**
 * User-facing copy for every native error code.
 *
 * Keyed by the generated `ErrorCode` union, which makes exhaustiveness a
 * compile error: add a variant in `error.rs`, regenerate, and the build fails
 * here until it has copy. Codes with no bespoke wording take an explicit
 * `generic` entry — a decision, not an accident.
 *
 * `database_corrupt` deliberately does NOT take the generic entry. It is the
 * one string shared with the browser namespace, and the dispatch test needs
 * the two paths to be distinguishable to be worth anything.
 */
import * as m from '$lib/paraglide/messages';
import type { ErrorCode } from '$lib/native/contracts.generated';
import type { ErrorParams } from '$lib/errors';

const generic = (): string => m.errors_unknown();

export const RUST_ERROR_MESSAGES: Record<ErrorCode, (params: ErrorParams) => string> = {
	database_busy: generic,
	database_locked: generic,
	database_not_ready: generic,
	database_update_required: generic,
	unauthorized_caller: generic,
	schema_too_old: generic,
	schema_too_new: generic,
	database_invalid: generic,
	database_corrupt: () => m.errors_native_database_corrupt(),
	backup_unavailable: generic,
	restore_failed: generic,
	operation_id_conflict: generic,
	amount_out_of_range: () => m.errors_amount_out_of_range(),
	invalid_ulid: generic,
	invalid_date: generic,
	invalid_input: generic,
	recovery_required: generic,
};
