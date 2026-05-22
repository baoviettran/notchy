import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as repo from '$lib/db/repos/categories';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('listBuckets', () => {
	it('returns seeded buckets', async () => {
		const buckets = await repo.listBuckets(db);
		expect(buckets).toHaveLength(4);
		expect(buckets[0].name).toBe('Essentials');
	});
});

describe('createBucket', () => {
	it('creates a new bucket', async () => {
		const id = await repo.createBucket(db, 'Custom');
		const buckets = await repo.listBuckets(db);
		expect(buckets.find((b) => b.id === id)?.name).toBe('Custom');
	});
});

describe('renameBucket', () => {
	it('renames a bucket', async () => {
		await repo.renameBucket(db, 'bucket_essentials', 'Needs');
		const buckets = await repo.listBuckets(db);
		expect(buckets.find((b) => b.id === 'bucket_essentials')?.name).toBe('Needs');
	});
});

describe('deleteBucket', () => {
	it('blocks deletion when bucket has active tags', async () => {
		await expect(repo.deleteBucket(db, 'bucket_adjustments')).rejects.toThrow('active tags');
	});

	it('deletes empty bucket', async () => {
		const id = await repo.createBucket(db, 'Empty');
		await repo.deleteBucket(db, id);
		const buckets = await repo.listBuckets(db);
		expect(buckets.find((b) => b.id === id)).toBeUndefined();
	});
});

describe('listTags', () => {
	it('returns all tags', async () => {
		const tags = await repo.listTags(db);
		expect(tags.length).toBeGreaterThanOrEqual(4);
	});

	it('filters by bucket', async () => {
		const tags = await repo.listTags(db, 'bucket_adjustments');
		expect(tags).toHaveLength(4);
	});
});

describe('createTag', () => {
	it('creates a tag in a bucket', async () => {
		const id = await repo.createTag(db, 'Coffee', 'bucket_essentials');
		const tags = await repo.listTags(db, 'bucket_essentials');
		expect(tags.find((t) => t.id === id)?.name).toBe('Coffee');
	});
});

describe('renameTag', () => {
	it('renames a tag', async () => {
		const id = await repo.createTag(db, 'Old Name', 'bucket_essentials');
		await repo.renameTag(db, id, 'New Name');
		const tags = await repo.listTags(db, 'bucket_essentials');
		expect(tags.find((t) => t.id === id)?.name).toBe('New Name');
	});
});

describe('moveTag', () => {
	it('moves a tag to another bucket', async () => {
		const id = await repo.createTag(db, 'Movable', 'bucket_essentials');
		await repo.moveTag(db, id, 'bucket_learning');
		const tags = await repo.listTags(db, 'bucket_learning');
		expect(tags.find((t) => t.id === id)?.name).toBe('Movable');
	});

	it('returns affected transaction info', async () => {
		const tagId = await repo.createTag(db, 'Tagged', 'bucket_essentials');
		// Create an account and transaction referencing this tag
		const now = new Date().toISOString();
		const today = now.split('T')[0];
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('a1', 'Acc', 'checking', 'VND', ?, ?)`,
			[now, now]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at) VALUES ('tx1', 'expense', ?, 50000, 'a1', ?, ?, ?)`,
			[today, tagId, now, now]
		);

		const info = await repo.moveTag(db, tagId, 'bucket_learning');
		expect(info.affected_count).toBe(1);
		expect(info.affected_total).toBe(50000);
	});
});

describe('deleteTag', () => {
	it('blocks deletion of system tags', async () => {
		await expect(
			repo.deleteTag(db, 'tag_initial_balance', 'uncategorise')
		).rejects.toThrow('System tags cannot be deleted');
	});

	it('uncategorise: soft-deletes tag, transactions keep tag_id', async () => {
		const tagId = await repo.createTag(db, 'Deletable', 'bucket_essentials');
		const now = new Date().toISOString();
		const today = now.split('T')[0];
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('a1', 'Acc', 'checking', 'VND', ?, ?)`,
			[now, now]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at) VALUES ('tx1', 'expense', ?, 50000, 'a1', ?, ?, ?)`,
			[today, tagId, now, now]
		);

		await repo.deleteTag(db, tagId, 'uncategorise');

		// Tag is gone from active list
		const tags = await repo.listTags(db, 'bucket_essentials');
		expect(tags.find((t) => t.id === tagId)).toBeUndefined();

		// Transaction still references the tag_id
		const txns = await db.query<{ tag_id: string }>(`SELECT tag_id FROM transactions WHERE id = 'tx1'`);
		expect(txns[0].tag_id).toBe(tagId);
	});

	it('merge: re-points transactions to target tag', async () => {
		const sourceId = await repo.createTag(db, 'Source', 'bucket_essentials');
		const targetId = await repo.createTag(db, 'Target', 'bucket_essentials');
		const now = new Date().toISOString();
		const today = now.split('T')[0];
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('a1', 'Acc', 'checking', 'VND', ?, ?)`,
			[now, now]
		);
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at) VALUES ('tx1', 'expense', ?, 50000, 'a1', ?, ?, ?)`,
			[today, sourceId, now, now]
		);

		await repo.deleteTag(db, sourceId, { merge_into: targetId });

		// Transaction now points to target
		const txns = await db.query<{ tag_id: string }>(`SELECT tag_id FROM transactions WHERE id = 'tx1'`);
		expect(txns[0].tag_id).toBe(targetId);

		// Source tag is soft-deleted
		const tags = await repo.listTags(db, 'bucket_essentials');
		expect(tags.find((t) => t.id === sourceId)).toBeUndefined();
	});
});
