import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { applyPragmas } from '$lib/db/pragmas';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('applyPragmas', () => {
	it('runs without error', async () => {
		await expect(applyPragmas(db)).resolves.toBeUndefined();
	});

	it('enables foreign keys', async () => {
		await applyPragmas(db);
		const rows = await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
		expect(rows[0].foreign_keys).toBe(1);
	});

	it('sets busy_timeout to 5000ms', async () => {
		await applyPragmas(db);
		const rows = await db.query<{ timeout: number }>('PRAGMA busy_timeout');
		expect(rows[0].timeout).toBe(5000);
	});

	it('does not error on journal_mode (in-memory returns "memory")', async () => {
		await applyPragmas(db);
		const rows = await db.query<{ journal_mode: string }>('PRAGMA journal_mode');
		expect(['memory', 'wal']).toContain(rows[0].journal_mode);
	});
});
