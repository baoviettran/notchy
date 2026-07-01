import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';
import { AppError } from '../../errors';

export interface Bucket {
	id: string;
	name: string;
	is_system: number;
	budgetable: number;
	rollover_enabled: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

export interface Tag {
	id: string;
	type_id: string;
	name: string;
	is_system: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

export interface TagDeleteInfo {
	affected_count: number;
	affected_total: number;
}

// --- Buckets ---

export async function listBuckets(db: DatabaseService): Promise<Bucket[]> {
	return db.query<Bucket>(
		`SELECT id, name, is_system, budgetable, rollover_enabled, sort_order, created_at, updated_at
		 FROM category_types WHERE deleted_at IS NULL ORDER BY sort_order`
	);
}

export async function createBucket(db: DatabaseService, name: string, budgetable = 1): Promise<string> {
	const now = new Date().toISOString();
	const id = ulid();
	const maxSort = await db.query<{ m: number | null }>(
		`SELECT MAX(sort_order) AS m FROM category_types WHERE deleted_at IS NULL`
	);
	const sort = (maxSort[0]?.m ?? -1) + 1;
	await db.execute(
		`INSERT INTO category_types (id, name, budgetable, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		[id, name, budgetable, sort, now, now]
	);
	return id;
}

export async function renameBucket(db: DatabaseService, id: string, name: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE category_types SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[name, now, id]
	);
}

export async function setRolloverEnabled(db: DatabaseService, id: string, enabled: boolean): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE category_types SET rollover_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[enabled ? 1 : 0, now, id]
	);
}

export async function deleteBucket(db: DatabaseService, id: string): Promise<void> {
	// Check for active tags
	const tags = await db.query<{ c: number }>(
		`SELECT COUNT(*) AS c FROM category_tags WHERE type_id = ? AND deleted_at IS NULL`, [id]
	);
	if (tags[0].c > 0) throw new AppError('bucket_has_tags');

	// Check for active transactions referencing tags in this bucket
	const txns = await db.query<{ c: number }>(
		`SELECT COUNT(*) AS c FROM transactions t
		 JOIN category_tags ct ON t.tag_id = ct.id
		 WHERE ct.type_id = ? AND t.deleted_at IS NULL`, [id]
	);
	if (txns[0].c > 0) throw new AppError('bucket_has_transactions');

	const now = new Date().toISOString();
	await db.execute(
		`UPDATE category_types SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[now, now, id]
	);
}

// --- Tags ---

export async function listTags(db: DatabaseService, bucketId?: string): Promise<Tag[]> {
	if (bucketId) {
		return db.query<Tag>(
			`SELECT id, type_id, name, is_system, sort_order, created_at, updated_at
			 FROM category_tags WHERE type_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
			[bucketId]
		);
	}
	return db.query<Tag>(
		`SELECT id, type_id, name, is_system, sort_order, created_at, updated_at
		 FROM category_tags WHERE deleted_at IS NULL ORDER BY sort_order`
	);
}

export async function createTag(db: DatabaseService, name: string, bucketId: string): Promise<string> {
	const now = new Date().toISOString();
	const id = ulid();
	const maxSort = await db.query<{ m: number | null }>(
		`SELECT MAX(sort_order) AS m FROM category_tags WHERE type_id = ? AND deleted_at IS NULL`, [bucketId]
	);
	const sort = (maxSort[0]?.m ?? -1) + 1;
	await db.execute(
		`INSERT INTO category_tags (id, type_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		[id, bucketId, name, sort, now, now]
	);
	return id;
}

export async function renameTag(db: DatabaseService, id: string, name: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE category_tags SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[name, now, id]
	);
}

export async function moveTag(db: DatabaseService, tagId: string, newBucketId: string): Promise<TagDeleteInfo> {
	// Get affected transaction info before moving
	const info = await getTagTransactionInfo(db, tagId);
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE category_tags SET type_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[newBucketId, now, tagId]
	);
	return info;
}

export async function getTagTransactionInfo(db: DatabaseService, tagId: string): Promise<TagDeleteInfo> {
	const rows = await db.query<{ c: number; t: number | null }>(
		`SELECT COUNT(*) AS c, SUM(amount) AS t FROM transactions WHERE tag_id = ? AND deleted_at IS NULL`,
		[tagId]
	);
	return { affected_count: rows[0].c, affected_total: rows[0].t ?? 0 };
}

export async function deleteTag(db: DatabaseService, id: string, option: 'uncategorise' | { merge_into: string }): Promise<void> {
	// System tags cannot be deleted
	const tag = await db.query<{ is_system: number }>(
		`SELECT is_system FROM category_tags WHERE id = ? AND deleted_at IS NULL`, [id]
	);
	if (tag.length === 0) throw new AppError('tag_not_found');
	if (tag[0].is_system === 1) throw new AppError('system_tag_no_delete');

	const now = new Date().toISOString();

	if (option === 'uncategorise') {
		// Soft-delete the tag; transactions keep their tag_id (rendered as "Uncategorised")
		await db.execute(
			`UPDATE category_tags SET deleted_at = ?, updated_at = ? WHERE id = ?`,
			[now, now, id]
		);
	} else {
		// Merge: re-point transactions to target, then soft-delete source
		await db.transaction(async (tx) => {
			await tx.execute(
				`UPDATE transactions SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL`,
				[option.merge_into, now, id]
			);
			await tx.execute(
				`UPDATE category_tags SET deleted_at = ?, updated_at = ? WHERE id = ?`,
				[now, now, id]
			);
		});
	}
}
