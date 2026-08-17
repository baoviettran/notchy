import type { DatabaseService } from '../service';
import { ulid } from '../../../utils/id';
import { AppError } from '../../../errors';
import { normalizePayee } from '../../../utils/normalize_payee';

export type MatchMode = 'is' | 'starts_with' | 'contains';
export type RuleSource = 'manual' | 'learned';

export interface CategorizeRule {
	id: string;
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
	source: RuleSource;
	enabled: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

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

function mapError(e: unknown): never {
	throw new AppError('database_error', { cause: String(e) });
}

export async function listRules(db: DatabaseService): Promise<CategorizeRule[]> {
	try {
		return await db.query<CategorizeRule>(
			`SELECT * FROM categorize_rules WHERE enabled = 1 AND deleted_at IS NULL ORDER BY created_at DESC`
		);
	} catch (e) {
		mapError(e);
	}
}

export async function listAllRules(db: DatabaseService): Promise<CategorizeRule[]> {
	try {
		return await db.query<CategorizeRule>(
			`SELECT * FROM categorize_rules ORDER BY created_at DESC`
		);
	} catch (e) {
		mapError(e);
	}
}

export async function createRule(
	db: DatabaseService,
	input: NewCategorizeRule
): Promise<CategorizeRule> {
	try {
		const id = ulid();
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO categorize_rules (id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			[id, input.payee_term, input.match_mode, input.tag_id, input.source, now, now]
		);
		const rows = await db.query<CategorizeRule>(
			`SELECT * FROM categorize_rules WHERE id = ?`,
			[id]
		);
		return rows[0];
	} catch (e) {
		mapError(e);
	}
}

export async function updateRule(
	db: DatabaseService,
	id: string,
	patch: CategorizeRuleUpdate
): Promise<CategorizeRule> {
	try {
		const sets: string[] = [];
		const params: unknown[] = [];

		if (patch.payee_term !== undefined) {
			sets.push('payee_term = ?');
			params.push(patch.payee_term);
		}
		if (patch.match_mode !== undefined) {
			sets.push('match_mode = ?');
			params.push(patch.match_mode);
		}
		if (patch.tag_id !== undefined) {
			sets.push('tag_id = ?');
			params.push(patch.tag_id);
		}
		if (patch.source !== undefined) {
			sets.push('source = ?');
			params.push(patch.source);
		}
		if (patch.enabled !== undefined) {
			sets.push('enabled = ?');
			params.push(patch.enabled);
		}

		sets.push('updated_at = ?');
		params.push(new Date().toISOString());
		params.push(id);

		await db.execute(`UPDATE categorize_rules SET ${sets.join(', ')} WHERE id = ?`, params);

		const rows = await db.query<CategorizeRule>(
			`SELECT * FROM categorize_rules WHERE id = ?`,
			[id]
		);
		return rows[0];
	} catch (e) {
		mapError(e);
	}
}

export async function deleteRule(db: DatabaseService, id: string): Promise<void> {
	try {
		await db.execute(
			`UPDATE categorize_rules SET deleted_at = ?, updated_at = ? WHERE id = ?`,
			[new Date().toISOString(), new Date().toISOString(), id]
		);
	} catch (e) {
		mapError(e);
	}
}

export async function upsertLearned(
	db: DatabaseService,
	payee_term: string,
	tag_id: string
): Promise<CategorizeRule> {
	try {
		const normalized = normalizePayee(payee_term);

		// Fetch all learned rules and filter in JS (normalization is in-memory only)
		const allLearned = await db.query<CategorizeRule>(
			`SELECT * FROM categorize_rules WHERE source = 'learned' AND deleted_at IS NULL`
		);

		const existing = allLearned.find(
			(r) => normalizePayee(r.payee_term) === normalized && r.match_mode === 'is'
		);

		if (existing) {
			return await updateRule(db, existing.id, { tag_id });
		}

		return await createRule(db, {
			payee_term,
			match_mode: 'is',
			tag_id,
			source: 'learned'
		});
	} catch (e) {
		mapError(e);
	}
}
