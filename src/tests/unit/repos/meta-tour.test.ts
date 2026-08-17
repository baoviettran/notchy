import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as meta from '$lib/db/repos/meta';
import type { DatabaseService } from '$lib/db';

let db: DatabaseService;
beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('isTourComplete', () => {
	it('returns false when tour_complete key is missing', async () => {
		expect(await meta.isTourComplete(db)).toBe(false);
	});

	it('returns true when tour_complete is 1', async () => {
		await meta.setTourComplete(db);
		expect(await meta.isTourComplete(db)).toBe(true);
	});
});
