import { describe, expect, it } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations';
import { BrowserProfilePort } from '$lib/profiles/browser';
import { ulid } from '$lib/utils/id';

const createDatabase = async () => {
	const db = createTestDb();
	await runMigrations(db, migrations);
	return db;
};
const context = () => ({ operationId: ulid(), transitionToken: null });

describe('browser profile port', () => {
	it('keeps account and currency data in separate real SQLite databases', async () => {
		const port = new BrowserProfilePort({ createDatabase });
		const a = await port.create(' A ', context());
		const b = await port.create('B', context());
		const aSession = await port.activate(a.id, null);
		const aDb = port.databaseFor(aSession);
		await aDb.meta.set('currency', 'USD');
		await aDb.accounts.create({ name: 'A cash', type: 'cash', currency: 'USD' });
		const tag = (await aDb.categories.listTags())[0];
		await aDb.rules.create({ payee_term: 'Coffee', match_mode: 'is', tag_id: tag.id, source: 'manual' });
		const bSession = await port.activate(b.id, null);
		const bDb = port.databaseFor(bSession);
		expect(await bDb.accounts.list()).toEqual([]);
		expect(await bDb.rules.list()).toEqual([]);
		expect(await bDb.meta.getCurrency()).not.toBe('USD');
		expect(() => port.databaseFor(aSession)).toThrow();
		const reopened = port.databaseFor(await port.activate(a.id, null));
		expect(await reopened.accounts.list()).toHaveLength(1);
		expect(await reopened.rules.list()).toHaveLength(1);
		expect(await reopened.meta.getCurrency()).toBe('USD');
	});
	it('trims names, accepts duplicates and counts Unicode code points', async () => {
		const port = new BrowserProfilePort({ createDatabase });
		await port.create('😀'.repeat(80), context());
		await expect(port.create('😀'.repeat(81), context())).rejects.toThrow();
		const first = await port.create('Same', context());
		const second = await port.create(' Same ', context());
		expect(second.name).toBe('Same');
		expect(second.id).not.toBe(first.id);
	});
});

describe('browser snapshot recovery', () => {
	it('restores a verified snapshot as a new profile and keeps shared preferences', async () => {
		const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const { createTestDbFromPath } = await import('./helpers/test-db');
		const root = mkdtempSync(join(tmpdir(), 'notchy-browser-profiles-'));
		const port = new BrowserProfilePort({
			createDatabase,
			exportSnapshot: async (db) => {
				const path = join(root, `${ulid()}.sqlite`);
				await db.execute(`VACUUM INTO '${path}'`);
				return readFileSync(path);
			},
			importSnapshot: async (bytes) => {
				const path = join(root, `${ulid()}.sqlite`);
				writeFileSync(path, bytes);
				return createTestDbFromPath(path);
			},
			readSnapshot: async (path) => readFileSync(path),
			writeSnapshot: async (path, bytes) => { writeFileSync(path, bytes); },
		});
		const original = await port.create('A', context());
		await port.setPreferences({ locale: 'vi', theme: 'dark' });
		const active = port.databaseFor(await port.activate(original.id, null));
		await active.meta.set('currency', 'USD');
		const source = join(root, 'A.sqlite');
		await port.exportBackup(original.id, source);
		const preview = await port.inspectRestore(source);
		writeFileSync(source, 'replaced after preview');
		expect(preview.suggestedName).toBe('A (2)');
		const restored = await port.restore(preview.token, preview.suggestedName, context());
		expect(restored.id).not.toBe(original.id);
		expect((await port.load()).preferences).toEqual({ locale: 'vi', theme: 'dark' });
		const restoredDb = port.databaseFor(await port.activate(restored.id, null));
		expect(await restoredDb.meta.getCurrency()).toBe('USD');
		await expect(active.meta.getCurrency()).rejects.toThrow();
	});
});


describe('browser restore validation', () => {
	it('rejects an unrelated SQLite file without publishing a profile', async () => {
		const port = new BrowserProfilePort({ createDatabase, readSnapshot: async () => new Uint8Array([1, 2, 3]) });
		await expect(port.inspectRestore('bad.sqlite')).rejects.toThrow();
		expect((await port.load()).profiles).toHaveLength(0);
	});
});
