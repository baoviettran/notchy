/**
 * Native goals adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/goals.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	Goal as NativeGoal,
	GoalType as NativeGoalType,
	GoalStatus as NativeGoalStatus,
	VelocityStatus as NativeVelocityStatus,
	GoalWithProgress as NativeGoalWithProgress,
} from '$lib/native/contracts.generated';

export type Goal = NativeGoal;
export type GoalType = NativeGoalType;
export type GoalStatus = NativeGoalStatus;
export type VelocityStatus = NativeVelocityStatus;
export type GoalWithProgress = NativeGoalWithProgress;

export interface NewGoal {
	name: string;
	type: GoalType;
	target_amount: number;
	target_date: string;
	linked_account_id?: string | null;
	starting_amount: number;
	show_on_dashboard?: number;
}

export async function listGoals(): Promise<GoalWithProgress[]> {
	throw new Error('native goals adapter not wired');
}

export async function getGoal(_id: string): Promise<GoalWithProgress | null> {
	throw new Error('native goals adapter not wired');
}

export async function createGoal(_input: NewGoal): Promise<string> {
	throw new Error('native goals adapter not wired');
}

export async function updateGoal(
	_id: string,
	_patch: Partial<NewGoal> & { status?: GoalStatus }
): Promise<void> {
	throw new Error('native goals adapter not wired');
}

export async function deleteGoal(_id: string): Promise<void> {
	throw new Error('native goals adapter not wired');
}
