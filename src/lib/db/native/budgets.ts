/**
 * Native budgets adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/budgets.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	Budget as NativeBudget,
	BudgetSummary as NativeBudgetSummary,
} from '$lib/native/contracts.generated';

export type Budget = NativeBudget;
export type BudgetSummary = NativeBudgetSummary;

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
