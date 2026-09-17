import * as m from '$lib/paraglide/messages';
import { AppError, NativeAppError } from '$lib/errors';
import { RUST_ERROR_MESSAGES } from './rust-error-messages';

/**
 * Map a caught error to a localized user-facing string. AppErrors resolve to
 * their `errors_<code>` message (reusing `validation_invalid_amount` for the
 * `invalid_amount` code — single source of truth for "Invalid amount"); any
 * other exception (an unknown AppError code, a native code with no copy entry —
 * a stale generated union — a plain Error, or a non-Error value) resolves to a
 * generic `errors_unknown` message.
 *
 * Static switch (not dynamic `m[key]()`) so the call sites stay type-checked.
 */
export function mapError(e: unknown): string {
	if (e instanceof NativeAppError) {
		// The table is typed exhaustive over the *generated* union, which a Rust
		// code added without regenerating leaves stale. The lookup is then
		// `undefined`, so calling it would throw from inside the mapper — the one
		// path built to stop a Rust rejection falling through to generic copy.
		return RUST_ERROR_MESSAGES[e.code]?.(e.params) ?? m.errors_unknown();
	}
	if (e instanceof AppError) {
		const p = e.params;
		switch (e.code) {
			case 'transfer_dest_required':
				return m.errors_transfer_dest_required();
			case 'transfer_dest_differs':
				return m.errors_transfer_dest_differs();
			case 'refund_not_expense':
				return m.errors_refund_not_expense();
			case 'refund_deleted_expense':
				return m.errors_refund_deleted_expense();
			case 'txn_not_found':
				return m.errors_txn_not_found();
			case 'txn_not_found_deleted':
				return m.errors_txn_not_found_deleted();
			case 'account_not_found':
				return m.errors_account_not_found();
			case 'account_currency_mismatch':
				return m.errors_account_currency_mismatch({ currency: String(p.currency) });
			case 'account_type_asset_liability':
				return m.errors_account_type_asset_liability();
			case 'account_type_loan':
				return m.errors_account_type_loan();
			case 'account_delete_linked_goals': {
				const count = Number(p.count);
				return count === 1
					? m.errors_account_delete_linked_goals_one({ count, names: String(p.names) })
					: m.errors_account_delete_linked_goals({ count, names: String(p.names) });
			}
			case 'counterparty_required':
				return m.errors_counterparty_required();
			case 'bucket_has_tags':
				return m.errors_bucket_has_tags();
			case 'bucket_has_transactions':
				return m.errors_bucket_has_transactions();
			case 'tag_not_found':
				return m.errors_tag_not_found();
			case 'system_tag_no_delete':
				return m.errors_system_tag_no_delete();
			case 'backup_corrupt':
				return m.errors_backup_corrupt();
			case 'backup_missing_schema_version':
				return m.errors_backup_missing_schema_version();
			case 'backup_schema_too_old':
				return m.errors_backup_schema_too_old();
			case 'backup_schema_newer':
				return m.errors_backup_schema_newer();
			case 'backup_missing_table':
				return m.errors_backup_missing_table();
			case 'invalid_amount':
				return m.validation_invalid_amount();
			default:
				return m.errors_unknown();
		}
	}
	return m.errors_unknown();
}
