import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { invokeMutation, type MutationOptions } from './mutation-intent';
import { toAppError } from './to-app-error';
export type NativeCall = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const MUTATIONS = new Set(["schedule_post_due", "account_create", "account_update", "account_delete", "account_restore", "transaction_create", "transaction_create_batch", "transaction_update", "transaction_delete", "transaction_restore", "transaction_duplicate", "transaction_delete_many", "transaction_set_tag_many", "transaction_set_account_many", "category_create_bucket", "category_rename_bucket", "category_set_rollover_enabled", "category_delete_bucket", "category_create_tag", "category_rename_tag", "category_move_tag", "category_delete_tag", "budget_set_allocation", "budget_copy_from_previous_month", "goal_create", "goal_update", "goal_delete", "goal_restore", "rule_create", "rule_update", "rule_delete", "rule_upsert_learned", "debt_write_off", "reconciliation_reconcile", "schedule_create", "schedule_update", "schedule_delete", "schedule_mark_posted", "schedule_mark_errored"]);
export async function invokeWith<T>(call: NativeCall, command: string, args?: Record<string, unknown>, options?: MutationOptions): Promise<T> {
	try {
		return MUTATIONS.has(command) ? await invokeMutation<T>(call, command, args, options) : await call<T>(command, args);
	} catch (error) { throw toAppError(error); }
}

export async function invoke<T>(command: string, args?: Record<string, unknown>, options?: MutationOptions): Promise<T> {
	return invokeWith<T>(tauriInvoke, command, args, options);
}
