/**
 * Native categories adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/categories.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	Bucket as NativeBucket,
	Tag as NativeTag,
	TagDeleteInfo as NativeTagDeleteInfo,
} from '$lib/native/contracts.generated';

export type Bucket = NativeBucket;
export type Tag = NativeTag;
export type TagDeleteInfo = NativeTagDeleteInfo;

export async function listBuckets(): Promise<Bucket[]> {
	throw new Error('native categories adapter not wired');
}

export async function createBucket(_name: string, _budgetable?: number): Promise<string> {
	throw new Error('native categories adapter not wired');
}

export async function renameBucket(_id: string, _name: string): Promise<void> {
	throw new Error('native categories adapter not wired');
}

export async function setRolloverEnabled(_id: string, _enabled: boolean): Promise<void> {
	throw new Error('native categories adapter not wired');
}

export async function deleteBucket(_id: string): Promise<void> {
	throw new Error('native categories adapter not wired');
}

export async function listTags(_bucketId?: string): Promise<Tag[]> {
	throw new Error('native categories adapter not wired');
}

export async function createTag(_name: string, _bucketId: string): Promise<string> {
	throw new Error('native categories adapter not wired');
}

export async function renameTag(_id: string, _name: string): Promise<void> {
	throw new Error('native categories adapter not wired');
}

export async function moveTag(_tagId: string, _newBucketId: string): Promise<TagDeleteInfo> {
	throw new Error('native categories adapter not wired');
}

export async function getTagTransactionInfo(_tagId: string): Promise<TagDeleteInfo> {
	throw new Error('native categories adapter not wired');
}

export async function deleteTag(
	_id: string,
	_option: 'uncategorise' | { merge_into: string }
): Promise<void> {
	throw new Error('native categories adapter not wired');
}
