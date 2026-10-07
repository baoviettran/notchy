/**
 * Native budgets adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/budgets.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	Budget as NativeBudget,
	BudgetSummary as NativeBudgetSummary,
	ToBudgetBreakdown as GeneratedToBudgetBreakdown,
} from '$lib/native/contracts.generated';
import type { ToBudgetBreakdown } from '$lib/db/client';

export type Budget = NativeBudget;
export type BudgetSummary = NativeBudgetSummary;

/**
 * Compile-time provenance guard for `ToBudgetBreakdown`.
 *
 * The active native path types `invoke<ToBudgetBreakdown>('budget_get_to_budget')`
 * (`src/lib/db/native/client.ts`) from the *hand-written* interface in
 * `src/lib/db/browser/repos/budgets.ts` (re-exported via `$lib/db/client`),
 * while the Rust DTO's generated TS mirror lives in
 * `src/lib/native/contracts.generated.ts`. `pnpm check:db-contracts` only
 * compares that generated file to its own generator, so renaming or retyping a
 * field on either side could leave every check green while the desktop build
 * deserialized a renamed key and read `undefined` at runtime — exactly the
 * snake_case-vs-camelCase hazard the spec calls out. These two assignments make
 * the shapes mutually assignable: change either one and `pnpm check` (which
 * type-checks this file) fails here instead.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const toBudgetBreakdownIsRustShaped: MutuallyAssignable<
	ToBudgetBreakdown,
	GeneratedToBudgetBreakdown
> = true;

export async function getBudgetsForMonth(_month: string): Promise<BudgetSummary[]> {
	throw new Error('native budgets adapter not wired');
}

export async function getSpentForBucket(_typeId: string, _month: string): Promise<number> {
	throw new Error('native budgets adapter not wired');
}

export async function getRolledOver(_typeId: string, _month: string): Promise<number> {
	throw new Error('native budgets adapter not wired');
}

export async function setAllocation(
	_typeId: string,
	_month: string,
	_allocated: number
): Promise<void> {
	throw new Error('native budgets adapter not wired');
}

export async function copyFromPreviousMonth(_targetMonth: string): Promise<void> {
	throw new Error('native budgets adapter not wired');
}

export async function hasAllocations(_month: string): Promise<boolean> {
	throw new Error('native budgets adapter not wired');
}
