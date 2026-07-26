// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import * as rules from '$lib/db/repos/rules';
import * as categories from '$lib/db/repos/categories';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('rules repo', () => {
	it('creates a rule', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const rule = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});

		expect(rule.payee_term).toBe('starbucks');
		expect(rule.match_mode).toBe('is');
		expect(rule.tag_id).toBe(tagId);
		expect(rule.source).toBe('manual');
		expect(rule.enabled).toBe(1);
	});

	it('lists enabled, non-deleted rules', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});
		const r2 = await rules.createRule(db, {
			payee_term: 'ca phe',
			match_mode: 'contains',
			tag_id: tagId,
			source: 'learned'
		});

		const list = await rules.listRules(db);
		expect(list).toHaveLength(2);
		expect(list.map((r) => r.id)).toContain(r1.id);
		expect(list.map((r) => r.id)).toContain(r2.id);
	});

	it('excludes disabled rules from listRules', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});
		await rules.updateRule(db, r1.id, { enabled: 0 });

		const list = await rules.listRules(db);
		expect(list).toHaveLength(0);
	});

	it('excludes soft-deleted rules from listRules', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});
		await rules.deleteRule(db, r1.id);

		const list = await rules.listRules(db);
		expect(list).toHaveLength(0);
	});

	it('listAllRules includes disabled and soft-deleted', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});
		await rules.updateRule(db, r1.id, { enabled: 0 });
		const r2 = await rules.createRule(db, {
			payee_term: 'ca phe',
			match_mode: 'contains',
			tag_id: tagId,
			source: 'learned'
		});
		await rules.deleteRule(db, r2.id);

		const list = await rules.listAllRules(db);
		expect(list).toHaveLength(2);
	});

	it('updates a rule', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});

		const updated = await rules.updateRule(db, r1.id, {
			payee_term: 'starbucks coffee',
			match_mode: 'starts_with'
		});

		expect(updated.payee_term).toBe('starbucks coffee');
		expect(updated.match_mode).toBe('starts_with');
	});

	it('soft-deletes a rule', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const r1 = await rules.createRule(db, {
			payee_term: 'starbucks',
			match_mode: 'is',
			tag_id: tagId,
			source: 'manual'
		});

		await rules.deleteRule(db, r1.id);

		const list = await rules.listAllRules(db);
		expect(list[0].deleted_at).not.toBeNull();
	});

	it('upsertLearned inserts new rule', async () => {
		const tagId = await categories.createTag(db, 'Food', 'bucket_essentials');
		const rule = await rules.upsertLearned(db, 'starbucks', tagId);

		expect(rule.payee_term).toBe('starbucks');
		expect(rule.match_mode).toBe('is');
		expect(rule.tag_id).toBe(tagId);
		expect(rule.source).toBe('learned');
	});

	it('upsertLearned updates existing rule with same normalized payee', async () => {
		const tag1 = await categories.createTag(db, 'Food', 'bucket_essentials');
		const tag2 = await categories.createTag(db, 'Drinks', 'bucket_essentials');

		const r1 = await rules.upsertLearned(db, 'ca phe', tag1);
		const r2 = await rules.upsertLearned(db, 'cà phê', tag2);

		expect(r2.id).toBe(r1.id);
		expect(r2.tag_id).toBe(tag2);

		const list = await rules.listRules(db);
		expect(list).toHaveLength(1);
	});
});
