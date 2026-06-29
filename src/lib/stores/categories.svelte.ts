import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/categories';
import type { Bucket, Tag } from '$lib/db/repos/categories';
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
			const db = await getDb();
			this.buckets = await repo.listBuckets(db);
			this.tags = await repo.listTags(db);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async createBucket(name: string, budgetable?: number): Promise<string> {
		const db = await getDb();
		const id = await repo.createBucket(db, name, budgetable);
		await this.load();
		return id;
	}

	async renameBucket(id: string, name: string): Promise<void> {
		const db = await getDb();
		await repo.renameBucket(db, id, name);
		await this.load();
	}

	async deleteBucket(id: string): Promise<void> {
		const db = await getDb();
		await repo.deleteBucket(db, id);
		await this.load();
	}

	async createTag(name: string, bucketId: string): Promise<string> {
		const db = await getDb();
		const id = await repo.createTag(db, name, bucketId);
		this.lastUsedBucketId = bucketId;
		await this.load();
		return id;
	}

	async renameTag(id: string, name: string): Promise<void> {
		const db = await getDb();
		await repo.renameTag(db, id, name);
		await this.load();
	}

	async moveTag(tagId: string, newBucketId: string): Promise<repo.TagDeleteInfo> {
		const db = await getDb();
		const info = await repo.moveTag(db, tagId, newBucketId);
		await this.load();
		return info;
	}

	async deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void> {
		const db = await getDb();
		await repo.deleteTag(db, id, option);
		await this.load();
	}
}

export const categories = new CategoriesStore();
