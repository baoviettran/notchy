// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import * as categories from '$lib/db/repos/categories';
import * as transactions from '$lib/db/repos/transactions';
import * as accounts from '$lib/db/repos/accounts';

// Mock getDb to return our test DB
let db: DatabaseService;
vi.mock('$lib/db', () => ({
	getDb: async () => db
}));

// Import after mocking
const { rules } = await import('$lib/stores/rules.svelte');

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	await rules.load();
});

describe('RulesStore', () => {
	it('matchTag returns null when no rules', () => {
		expect(rules.matchTag('starbucks')).toBeNull();
	});

	it('matchTag returns tag_id when rule matches', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		await rules.create({
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});

		expect(rules.matchTag('starbucks')).toBe(tagId);
	});

	it('learnRule creates rule after 3 consistent transactions', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const accountId = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND'
		});

		// Create 3 transactions with same payee + tag
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tagId
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tagId
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tagId
		});

		// Trigger learn
		const result = await rules.learnRule('starbucks', tagId);

		expect(result.learned).toBe(true);
		expect(result.ruleId).toBeDefined();

		// Verify rule was created
		expect(rules.matchTag('starbucks')).toBe(tagId);
	});

	it('learnRule groups diacritic variants as same payee', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const accountId = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND'
		});

		// Create 3 transactions with diacritic variants
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: accountId,
			payee: 'cà phê',
			tag_id: tagId
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: accountId,
			payee: 'ca phe',
			tag_id: tagId
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: accountId,
			payee: 'CÀ PHÊ',
			tag_id: tagId
		});

		// Trigger learn with normalized form
		const result = await rules.learnRule('ca phe', tagId);

		expect(result.learned).toBe(true);

		// Verify rule matches both variants
		expect(rules.matchTag('cà phê')).toBe(tagId);
		expect(rules.matchTag('ca phe')).toBe(tagId);
	});

	it('learnRule does not create rule on inconsistent tags', async () => {
		const tag1 = await categories.createTag(db, 'Food', 'bucket_essentials');
		const tag2 = await categories.createTag(db, 'Drinks', 'bucket_essentials');
		const accountId = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND'
		});

		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tag1
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tag2
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-03',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tag1
		});

		const result = await rules.learnRule('starbucks', tag1);

		expect(result.learned).toBe(false);
	});

	it('learnRule does not create rule with fewer than 3 transactions', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const accountId = await accounts.createAccount(db, {
			name: 'Cash',
			type: 'cash',
			currency: 'VND'
		});

		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-01',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tagId
		});
		await transactions.createTransaction(db, {
			kind: 'expense',
			date: '2026-01-02',
			amount: 50000,
			account_id: accountId,
			payee: 'starbucks',
			tag_id: tagId
		});

		const result = await rules.learnRule('starbucks', tagId);

		expect(result.learned).toBe(false);
	});

	it('learnRule no-ops on empty payee', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const result = await rules.learnRule('', tagId);
		expect(result.learned).toBe(false);
	});

	it('learnRule no-ops on empty tag_id', async () => {
		const result = await rules.learnRule('starbucks', '');
		expect(result.learned).toBe(false);
	});
});
