// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { matchRules, type CategorizeRuleLite } from '$lib/utils/rules_matcher';

describe('matchRules', () => {
	it('returns null for null payee', () => {
		expect(matchRules(null, [])).toBeNull();
	});

	it('returns null for empty payee', () => {
		expect(matchRules('', [])).toBeNull();
	});

	it('returns null for empty rules', () => {
		expect(matchRules('starbucks', [])).toBeNull();
	});

	it('matches exact (is) rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('does not match a different or empty normalized payee', () => {
		const exactRules: CategorizeRuleLite[] = [
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('Starbucks Reserve', exactRules)).toBeNull();

		const emptyTermRules: CategorizeRuleLite[] = [
			{ payee_term: '', match_mode: 'contains', tag_id: 'tag-1' }
		];
		expect(matchRules('   ', emptyTermRules)).toBeNull();
	});

	it('matches starts_with rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('matches contains rule', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'bucks', match_mode: 'contains', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('ranks is > starts_with > contains', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'starbucks', match_mode: 'contains', tag_id: 'tag-contains' },
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-starts' },
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-is' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-is');
	});

	it('ignores non-matching rules when resolving the highest rank', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'coffee', match_mode: 'contains', tag_id: 'tag-contains' },
			{ payee_term: 'starbucks', match_mode: 'is', tag_id: 'tag-is' },
			{ payee_term: 'starbucks reserve', match_mode: 'is', tag_id: 'tag-unmatched-is' }
		];

		expect(matchRules('starbucks', rules)).toBe('tag-is');
	});

	it('returns null on tie with different tags', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' },
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-2' }
		];
		expect(matchRules('starbucks', rules)).toBeNull();
	});

	it('returns tag on tie with same tag', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'star', match_mode: 'starts_with', tag_id: 'tag-1' },
			{ payee_term: 'starbucks', match_mode: 'starts_with', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (case)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'STARBUCKS', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('starbucks', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (Vietnamese diacritics)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'cà phê', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('ca phe', rules)).toBe('tag-1');
	});

	it('normalizes payee before matching (whitespace)', () => {
		const rules: CategorizeRuleLite[] = [
			{ payee_term: 'ca phe', match_mode: 'is', tag_id: 'tag-1' }
		];
		expect(matchRules('  ca   phe  ', rules)).toBe('tag-1');
	});
});
