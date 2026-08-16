import { describe, expect, it } from 'vitest';
import { inspectSchema } from '$lib/db/schema';
import { createTestDb } from './helpers/test-db';

describe('inspectSchema', () => {
	it('classifies an empty database as fresh', async () => {
		expect(await inspectSchema(createTestDb(), 5)).toEqual({ kind: 'fresh' });
	});

	it('classifies supported older, current, and newer versions without writing', async () => {
		for (const [version, kind] of [[1, 'older'], [4, 'older'], [5, 'current'], [6, 'newer']] as const) {
			const db = createTestDb();
			await db.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
			await db.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
			await db.execute("INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)", [String(version)]);
			expect(await inspectSchema(db, 5)).toEqual({ kind, version });
		}
	});

	it('rejects an existing database with missing or malformed schema metadata', async () => {
		const missingAppMeta = createTestDb();
		await missingAppMeta.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
		expect(await inspectSchema(missingAppMeta, 5)).toEqual({
			kind: 'invalid',
			reason: 'missing_schema_version'
		});

		const missingSchemaRow = createTestDb();
		await missingSchemaRow.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await missingSchemaRow.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
		expect(await inspectSchema(missingSchemaRow, 5)).toEqual({
			kind: 'invalid',
			reason: 'missing_schema_version'
		});

		const malformed = createTestDb();
		await malformed.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await malformed.execute("INSERT INTO app_meta VALUES ('schema_version', 'five')");
		expect(await inspectSchema(malformed, 5)).toEqual({
			kind: 'invalid',
			reason: 'invalid_schema_version'
		});

		const zeroVersion = createTestDb();
		await zeroVersion.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await zeroVersion.execute("INSERT INTO app_meta VALUES ('schema_version', '0')");
		expect(await inspectSchema(zeroVersion, 5)).toEqual({
			kind: 'invalid',
			reason: 'invalid_schema_version'
		});
	});
});
