import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as catRepo from '$lib/db/repos/categories';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('listBuckets', () => {
	it('includes rollover_enabled (default 1 on seeded buckets)', async () => {
		const buckets = await catRepo.listBuckets(db);
		const essentials = buckets.find((b) => b.id === 'bucket_essentials')!;
		expect(essentials.rollover_enabled).toBe(1);
	});
});

describe('setRolloverEnabled', () => {
	it('disables and re-enables roll-over for a bucket', async () => {
		await catRepo.setRolloverEnabled(db, 'bucket_essentials', false);
		let buckets = await catRepo.listBuckets(db);
		expect(buckets.find((b) => b.id === 'bucket_essentials')!.rollover_enabled).toBe(0);

		await catRepo.setRolloverEnabled(db, 'bucket_essentials', true);
		buckets = await catRepo.listBuckets(db);
		expect(buckets.find((b) => b.id === 'bucket_essentials')!.rollover_enabled).toBe(1);
	});

	it('is idempotent', async () => {
		await catRepo.setRolloverEnabled(db, 'bucket_essentials', false);
		await catRepo.setRolloverEnabled(db, 'bucket_essentials', false);
		const buckets = await catRepo.listBuckets(db);
		expect(buckets.find((b) => b.id === 'bucket_essentials')!.rollover_enabled).toBe(0);
	});
});
