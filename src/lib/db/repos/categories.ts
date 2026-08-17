// Forwarder — canonical implementation moved to browser/repos/categories.ts
export {
	type Bucket,
	type Tag,
	type TagDeleteInfo,
	listBuckets,
	createBucket,
	renameBucket,
	setRolloverEnabled,
	deleteBucket,
	listTags,
	createTag,
	renameTag,
	moveTag,
	getTagTransactionInfo,
	deleteTag
} from '../browser/repos/categories';
