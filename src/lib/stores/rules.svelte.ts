import { getDb } from '$lib/db';
import type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate } from '$lib/db/client';
import { matchRules, type CategorizeRuleLite } from '$lib/utils/rules_matcher';
import { normalizePayee } from '$lib/utils/normalize_payee';
import { mapError } from '$lib/utils/errors';

class RulesStore {
	items = $state<CategorizeRule[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	get active(): CategorizeRuleLite[] {
		return this.items
			.filter((r) => r.enabled === 1 && r.deleted_at === null)
			.map((r) => ({
				payee_term: r.payee_term,
				match_mode: r.match_mode,
				tag_id: r.tag_id
			}));
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.rules.listAll();
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	matchTag(payee: string | null): string | null {
		return matchRules(payee, this.active);
	}

	async create(input: NewCategorizeRule): Promise<CategorizeRule> {
		const db = getDb();
		const rule = await db.rules.create(input);
		await this.load();
		return rule;
	}

	async update(id: string, patch: CategorizeRuleUpdate): Promise<CategorizeRule> {
		const db = getDb();
		const rule = await db.rules.update(id, patch);
		await this.load();
		return rule;
	}

	async delete(id: string): Promise<void> {
		const db = getDb();
		await db.rules.delete(id);
		await this.load();
	}

	async learnRule(payee: string, tag_id: string): Promise<{ learned: boolean; ruleId?: string }> {
		if (!payee || !tag_id) {
			return { learned: false };
		}

		try {
			const db = getDb();

			// Fetch last 50 transactions
			const recent = await db.transactions.list({
				limit: 50
			});

			// Normalize each payee and find matches
			const normalizedInput = normalizePayee(payee);
			const matches = recent.filter(
				(t) => t.payee && normalizePayee(t.payee) === normalizedInput
			);

			// Need at least 3
			if (matches.length < 3) {
				return { learned: false };
			}

			// Check if all matching transactions have the same tag_id
			const tagIds = new Set(matches.map((t) => t.tag_id));
			if (tagIds.size !== 1) {
				return { learned: false };
			}

			// All consistent — upsert learned rule
			const rule = await db.rules.upsertLearned(payee, tag_id);
			await this.load();

			return { learned: true, ruleId: rule.id };
		} catch (error) {
			// Log but don't throw — learning failure must not break save
			console.error('Failed to learn rule:', error);
			return { learned: false };
		}
	}
}

export const rules = new RulesStore();
