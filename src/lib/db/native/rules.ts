/**
 * Native rules adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/rules.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	CategorizeRule as NativeCategorizeRule,
	MatchMode as NativeMatchMode,
	RuleSource as NativeRuleSource,
} from '$lib/native/contracts.generated';

export type CategorizeRule = NativeCategorizeRule;
export type MatchMode = NativeMatchMode;
export type RuleSource = NativeRuleSource;

export interface NewCategorizeRule {
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
	source: RuleSource;
}

export interface CategorizeRuleUpdate {
	payee_term?: string;
	match_mode?: MatchMode;
	tag_id?: string;
	source?: RuleSource;
	enabled?: number;
}

export async function listRules(): Promise<CategorizeRule[]> {
	throw new Error('native rules adapter not wired');
}

export async function listAllRules(): Promise<CategorizeRule[]> {
	throw new Error('native rules adapter not wired');
}

export async function createRule(_input: NewCategorizeRule): Promise<CategorizeRule> {
	throw new Error('native rules adapter not wired');
}

export async function updateRule(
	_id: string,
	_patch: CategorizeRuleUpdate
): Promise<CategorizeRule> {
	throw new Error('native rules adapter not wired');
}

export async function deleteRule(_id: string): Promise<void> {
	throw new Error('native rules adapter not wired');
}

export async function upsertLearned(
	_payee_term: string,
	_tag_id: string
): Promise<CategorizeRule> {
	throw new Error('native rules adapter not wired');
}
