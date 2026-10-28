// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAutomaticBackupChecks } from '$lib/backup/automatic';
import { automaticBackupState } from '$lib/backup/status.svelte';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { migrations } from '$lib/db/browser/migrations';
import type { AppDatabase } from '$lib/db/client';
import type { ProfileSession } from '$lib/profiles/types';
const a = { profileId: 'A', generation: '1' };
const b = { profileId: 'B', generation: '2' };
let raw: ReturnType<typeof createTestDb>;
let db: AppDatabase;
let current: ProfileSession | null;
let cleanups: (() => void)[];
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
beforeEach(async () => {
	vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
	raw = createTestDb(); await runMigrations(raw, migrations);
	db = new BrowserDatabaseClient(raw); current = a; cleanups = [];
	automaticBackupState.reset(a);
	await db.meta.set('first_run_complete', '1');
});
afterEach(async () => { cleanups.forEach(stop => stop()); vi.useRealTimers(); await raw.close(); });
function start() { const stop = startAutomaticBackupChecks(db, () => current); cleanups.push(stop); return stop; }
async function copies() { return (await raw.query<{ count: number }>('SELECT COUNT(*) AS count FROM automatic_backup_copies'))[0].count; }
describe('open-app automatic backup checks', () => {
	it('does check activation and deduplicate main and Quick Add requests without native filesystem calls', async () => {
		start(); start(); await flush();
		expect(await copies()).toBe(1);
		expect(automaticBackupState.status?.lastSuccessDate).toBe('2026-10-28');
	});
	it('does resume after a date rollover once and checks changed content on the timer', async () => {
		start(); await flush(); await db.meta.set('currency', 'USD');
		vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
		window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await flush();
		expect(await copies()).toBe(2);
		await db.meta.set('currency', 'VND');
		vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
		await vi.advanceTimersByTimeAsync(60_000); await flush();
		expect(await copies()).toBe(3);
	});
	it('does clear timers and listeners on teardown and stops checking an expired session', async () => {
		const stop = start(); await flush(); const before = automaticBackupState.status;
		stop(); await db.meta.set('currency', 'USD');
		vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
		window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(120_000); await flush();
		expect(await copies()).toBe(1); expect(automaticBackupState.status).toEqual(before);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('does ignore late backup results when the profile changes', async () => {
		let resolve!: (value: Awaited<ReturnType<AppDatabase['backup']['checkAutomatic']>>) => void;
		const original = db.backup.checkAutomatic.bind(db.backup);
		db.backup.checkAutomatic = () => new Promise(done => { resolve = done; });
		start(); current = b; automaticBackupState.reset(b);
		const before = automaticBackupState.status;
		resolve(await original()); await flush();
		const profileBStatus = automaticBackupState.status;
		expect(profileBStatus).toEqual(before);
	});
	it('does persist enable toggles without marking content backed up', async () => {
		await db.backup.setAutomaticEnabled(false);
		expect((await db.backup.checkAutomatic()).lastSuccessAt).toBeNull();
		expect((await new BrowserDatabaseClient(raw).backup.automaticStatus()).enabled).toBe(false);
		await db.backup.setAutomaticEnabled(true); await db.backup.checkAutomatic();
		expect(await copies()).toBe(1);
	});
});

it('does check immediately when a bound Quick Add window starts hidden', async () => {
	const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
	try { start(); await flush(); expect(await copies()).toBe(1); }
	finally { visibility.mockRestore(); }
});
