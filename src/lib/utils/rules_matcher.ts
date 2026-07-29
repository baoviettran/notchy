import { normalizePayee } from './normalize_payee';

export type MatchMode = 'is' | 'starts_with' | 'contains';

export interface CategorizeRuleLite {
	payee_term: string;
	match_mode: MatchMode;
	tag_id: string;
}

const RANK: Record<MatchMode, number> = { is: 3, starts_with: 2, contains: 1 };

export function matchRules(payee: string | null, rules: CategorizeRuleLite[]): string | null {
	if (!payee || rules.length === 0) return null;

	const normalizedPayee = normalizePayee(payee);
	if (!normalizedPayee) return null;

	const matches: CategorizeRuleLite[] = [];

	for (const rule of rules) {
		const normalizedTerm = normalizePayee(rule.payee_term);
		if (!normalizedTerm) continue;
		// Every case below reassigns isMatch; the false default only guards an
	// out-of-type match_mode at runtime (TS prevents that at compile time).
	let isMatch = false;

		switch (rule.match_mode) {
			case 'is':
				isMatch = normalizedPayee === normalizedTerm;
				break;
			case 'starts_with':
				isMatch = normalizedPayee.startsWith(normalizedTerm);
				break;
			case 'contains':
				isMatch = normalizedPayee.includes(normalizedTerm);
				break;
		}

		if (isMatch) {
			matches.push(rule);
		}
	}

	if (matches.length === 0) return null;

	// Find the highest rank
	const maxRank = Math.max(...matches.map((m) => RANK[m.match_mode]));
	const topMatches = matches.filter((m) => RANK[m.match_mode] === maxRank);

	// If all top matches target the same tag, return it; otherwise null (ambiguous)
	const uniqueTags = new Set(topMatches.map((m) => m.tag_id));
	if (uniqueTags.size === 1) {
		return topMatches[0].tag_id;
	}

	return null;
}
