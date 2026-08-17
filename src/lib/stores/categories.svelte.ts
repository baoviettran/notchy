import { getDb } from '$lib/db';
import type { Bucket, Tag, TagDeleteInfo } from '$lib/db/client';
import { mapError } from '$lib/utils/errors';

class CategoriesStore {
	buckets = $state<Bucket[]>([]);
	tags = $state<Tag[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	lastUsedBucketId = $state<string | null>(null);

	tagsForBucket(bucketId: string): Tag[] {
		return this.tags.filter((t) => t.type_id === bucketId);
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.buckets = await db.categories.listBuckets();
			this.tags = await db.categories.listTags();
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async createBucket(name: string, budgetable?: number): Promise<string> {
		const db = getDb();
		const id = await db.categories.createBucket(name, budgetable);
		await this.load();
		return id;
	}

	async renameBucket(id: string, name: string): Promise<void> {
		const db = getDb();
		await db.categories.renameBucket(id, name);
		await this.load();
	}

	async deleteBucket(id: string): Promise<void> {
		const db = getDb();
		await db.categories.deleteBucket(id);
		await this.load();
	}

	async createTag(name: string, bucketId: string): Promise<string> {
		const db = getDb();
		const id = await db.categories.createTag(name, bucketId);
		this.lastUsedBucketId = bucketId;
		await this.load();
		return id;
	}

	async renameTag(id: string, name: string): Promise<void> {
		const db = getDb();
		await db.categories.renameTag(id, name);
		await this.load();
	}

	async moveTag(tagId: string, newBucketId: string): Promise<TagDeleteInfo> {
		const db = getDb();
		const info = await db.categories.moveTag(tagId, newBucketId);
		await this.load();
		return info;
	}

	async deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void> {
		const db = getDb();
		await db.categories.deleteTag(id, option);
		await this.load();
	}
}

export const categories = new CategoriesStore();
