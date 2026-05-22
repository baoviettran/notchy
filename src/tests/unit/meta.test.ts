import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as meta from '$lib/db/repos/meta';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('meta repository', () => {
	it('gets and sets meta values', async () => {
		await meta.setMeta(db, 'test_key', 'test_value');
		expect(await meta.getMeta(db, 'test_key')).toBe('test_value');
	});

	it('returns null for missing keys', async () => {
		expect(await meta.getMeta(db, 'nonexistent')).toBeNull();
	});

	it('isFirstRunComplete defaults to false', async () => {
		expect(await meta.isFirstRunComplete(db)).toBe(false);
	});

	it('isFirstRunComplete returns true after setting', async () => {
		await meta.setMeta(db, 'first_run_complete', '1');
		expect(await meta.isFirstRunComplete(db)).toBe(true);
	});

	it('getLocale defaults to en', async () => {
		expect(await meta.getLocale(db)).toBe('en');
	});

	it('getCurrency defaults to VND', async () => {
		expect(await meta.getCurrency(db)).toBe('VND');
	});
});
