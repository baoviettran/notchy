import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { migrations } from '$lib/db/browser/migrations';
import { installContentRevisionTriggers } from '$lib/db/browser/content-revision';

let raw: ReturnType<typeof createTestDb>;
let db: BrowserDatabaseClient;
beforeEach(async () => {
	vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
	raw = createTestDb(); await runMigrations(raw, migrations); db = new BrowserDatabaseClient(raw);
});
afterEach(async () => { await raw.close(); vi.useRealTimers(); });
describe('browser automatic backup model over real SQLite', () => {
	it('does preserve a clean profile and atomically capture only committed changed content once per day', async () => {
		expect((await db.backup.checkAutomatic()).lastSuccessAt).toBeNull();
		await expect(raw.transaction(async tx => { await tx.execute("INSERT INTO app_meta VALUES ('currency','USD')"); throw new Error('rollback'); })).rejects.toThrow('rollback');
		expect((await db.backup.checkAutomatic()).contentRevision).toBe(0);
		await db.meta.set('currency', 'USD');
		const [main, quick] = await Promise.all([db.backup.checkAutomatic(), db.backup.checkAutomatic()]);
		expect(main).toEqual(quick); expect(main.lastSuccessDate).toBe('2026-10-28');
		await db.meta.set('currency', 'VND'); await db.backup.checkAutomatic();
		expect((await raw.query<{ count: number }>('SELECT COUNT(*) AS count FROM automatic_backup_copies'))[0].count).toBe(1);
		vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
		const next = await db.backup.checkAutomatic();
		expect(next.lastSuccessDate).toBe('2026-10-29'); expect(next.backedUpRevision).toBe(2);
	});
	it('does preserve the preference and last success when a browser adapter is rebound', async () => {
		await db.meta.set('currency', 'USD'); const good = await db.backup.checkAutomatic();
		await db.backup.setAutomaticEnabled(false); await db.meta.set('currency', 'VND');
		vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
		const rebound = new BrowserDatabaseClient(raw);
		expect(await rebound.backup.checkAutomatic()).toEqual({ ...good, enabled: false, contentRevision: 2, nextEligibleDate: null });
	});
	it('does register new content tables for later migrations and ignore timestamp-only updates', async () => {
		await raw.execute('CREATE TABLE future_content (id TEXT PRIMARY KEY, value INTEGER, created_at TEXT, updated_at TEXT)');
		await raw.transaction(tx => installContentRevisionTriggers(tx, ['future_content']));
		await raw.execute("INSERT INTO future_content VALUES ('x',1,'created','updated')");
		expect((await db.backup.automaticStatus()).contentRevision).toBe(1);
		await raw.execute("UPDATE future_content SET updated_at='later'");
		expect((await db.backup.automaticStatus()).contentRevision).toBe(1);
		await raw.execute('UPDATE future_content SET value=2');
		expect((await db.backup.automaticStatus()).contentRevision).toBe(2);
		await expect(raw.transaction(async tx => { await tx.execute('DELETE FROM future_content'); throw new Error('rollback'); })).rejects.toThrow('rollback');
		expect((await db.backup.automaticStatus()).contentRevision).toBe(2);
		await raw.execute('DELETE FROM future_content');
		expect((await db.backup.automaticStatus()).contentRevision).toBe(3);
	});
});
