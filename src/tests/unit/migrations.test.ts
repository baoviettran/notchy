import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('Migration 001 - schema', () => {
	it('creates all expected tables', async () => {
		const tables = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
		);
		const names = tables.map((t) => t.name);
		expect(names).toContain('accounts');
		expect(names).toContain('category_types');
		expect(names).toContain('category_tags');
		expect(names).toContain('transactions');
		expect(names).toContain('budgets');
		expect(names).toContain('goals');
		expect(names).toContain('reconciliations');
		expect(names).toContain('change_log');
	});

	it('creates indexes', async () => {
		const indexes = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`
		);
		expect(indexes.length).toBe(13);
	});
});

describe('Migration 002 - triggers', () => {
	it('creates 21 triggers (3 per 7 tables)', async () => {
		const triggers = await db.query<{ name: string }>(
			`SELECT name FROM sqlite_master WHERE type='trigger'`
		);
		expect(triggers.length).toBe(21);
	});

	it('trigger writes to change_log on insert', async () => {
		const now = new Date().toISOString();
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			['acc1', 'Test Account', 'checking', 'VND', now, now]
		);

		const logs = await db.query<{ table_name: string; row_id: string; operation: string; payload: string }>(
			`SELECT table_name, row_id, operation, payload FROM change_log WHERE table_name = 'accounts'`
		);
		expect(logs).toHaveLength(1);
		expect(logs[0].row_id).toBe('acc1');
		expect(logs[0].operation).toBe('insert');
		const payload = JSON.parse(logs[0].payload);
		expect(payload.name).toBe('Test Account');
	});
});

describe('Migration 003 - seed data', () => {
	it('seeds 4 buckets', async () => {
		const buckets = await db.query<{ id: string; name: string }>(
			`SELECT id, name FROM category_types ORDER BY sort_order`
		);
		expect(buckets).toHaveLength(4);
		expect(buckets[0].name).toBe('Essentials');
		expect(buckets[3].name).toBe('Adjustments');
	});

	it('seeds 4 system tags under Adjustments', async () => {
		const tags = await db.query<{ name: string; is_system: number }>(
			`SELECT name, is_system FROM category_tags WHERE type_id = 'bucket_adjustments'`
		);
		expect(tags).toHaveLength(4);
		expect(tags.every((t) => t.is_system === 1)).toBe(true);
	});

	it('generates a device_id ULID', async () => {
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'device_id'`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toHaveLength(26);
	});

	it('schema_version is 3', async () => {
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'schema_version'`
		);
		expect(rows[0].value).toBe('3');
	});
});
