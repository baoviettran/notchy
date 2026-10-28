import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestDbFromPath } from './helpers/test-db';
import type { DatabaseService } from '$lib/db';
import { migrations } from '$lib/db/browser/migrations';
import { runMigrations } from '$lib/db/browser/migrations/runner';
import { setMeta, deleteMeta } from '$lib/db/browser/repos/meta';
import { validateDatabase } from '$lib/backup/validation';
let db: DatabaseService;
const revision = async () => (await db.query<{
	content_revision: number;
}>('SELECT content_revision FROM automatic_backup_state WHERE id=1'))[0].content_revision;
const account = () => db.execute("INSERT INTO accounts (id,name,type,created_at,updated_at) VALUES ('a','Cash','cash','x','x')");
const expense = (tx: DatabaseService, id: string) => tx.execute("INSERT INTO transactions (id,kind,date,amount,account_id,created_at,updated_at) VALUES (?,'expense','2026-10-26',100,'a','x','x')", [id]);
beforeEach(() => { db = createTestDb(); });
afterEach(async () => { await db.close(); });
describe('automatic backup content revisions', () => {
	it('tracks_only_committed_content_changes', async () => {
		await runMigrations(db, migrations);
		await account();
		const before = await revision();
		await expect(db.transaction(async (tx) => { await expense(tx, 'rollback'); throw new Error('rollback'); })).rejects.toThrow('rollback');
		expect(await revision()).toBe(before);
		await expense(db, 'committed');
		const after = await revision();
		expect(after).toBeGreaterThan(before);
		await db.execute("UPDATE transactions SET amount=amount,updated_at='later'");
		expect(await revision()).toBe(after);
		await db.execute('UPDATE transactions SET amount=200');
		expect(await revision()).toBeGreaterThan(after);
		const beforeDelete = await revision();
		await db.execute('DELETE FROM transactions');
		expect(await revision()).toBeGreaterThan(beforeDelete);
	});
	it('tracks first-use financial metadata through real setters without counting repeated or ignored values', async () => {
		await runMigrations(db, migrations);
		for (const key of ['currency', 'first_run_complete', 'onboarding_step']) {
			const before = await revision();
			await setMeta(db, key, '1');
			const after = await revision();
			expect(after).toBeGreaterThan(before);
			await setMeta(db, key, '1');
			expect(await revision()).toBe(after);
			await db.execute("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,'ignored')", [key]);
			expect(await revision()).toBe(after);
			await setMeta(db, key, '2');
			expect(await revision()).toBeGreaterThan(after);
			const beforeDelete = await revision();
			await deleteMeta(db, key);
			expect(await revision()).toBeGreaterThan(beforeDelete);
		}
		const before = await revision();
		await expect(db.transaction(async (tx) => { await setMeta(tx, 'currency', 'USD'); throw new Error('rollback'); })).rejects.toThrow('rollback');
		expect(await revision()).toBe(before);
	});
	it('ignores backup state, registry, logs, and nonfinancial profile metadata', async () => {
		await runMigrations(db, migrations);
		const before = await revision();
		for (const key of ['locale', 'theme', 'last_opened_at', 'last_backup_at', 'receipt_id', 'last_successful_app_version'])
			await setMeta(db, key, 'x');
		await db.execute("UPDATE automatic_backup_state SET enabled=0,warning='retry',prune_warning='retry',last_success_at='x',last_success_date='2026-10-26'");
		await db.execute("INSERT INTO automatic_backup_copies (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes) VALUES ('copy','owned.sqlite',7,0,'2026-10-26','2026-W44','x','job',420)");
		await db.execute("INSERT INTO change_log (table_name,row_id,operation,timestamp,device_id) VALUES ('accounts','x','insert','x','x')");
		expect(await revision()).toBe(before);
	});
	it('leaves fresh scratch profiles clean and makes meaningful new profiles eligible', async () => {
		await runMigrations(db, migrations);
		expect(await db.query('SELECT enabled,content_revision,backed_up_revision,last_success_at,last_success_date,warning,prune_warning FROM automatic_backup_state')).toEqual([{ enabled: 1, content_revision: 0, backed_up_revision: 0, last_success_at: null, last_success_date: null, warning: null, prune_warning: null }]);
		await setMeta(db, 'first_run_complete', '1');
		expect(await revision()).toBeGreaterThan(0);
	});
	it('migrates a populated schema-6 ledger dirty without changing financial data', async () => {
		await runMigrations(db, migrations.filter(m => m.version <= 6));
		await account();
		await expense(db, 'existing');
		await runMigrations(db, migrations);
		expect(await db.query('SELECT content_revision,backed_up_revision FROM automatic_backup_state')).toEqual([{ content_revision: 1, backed_up_revision: 0 }]);
		expect(await db.query("SELECT amount FROM transactions WHERE id='existing'")).toEqual([{ amount: 100 }]);
	});
	it.each([null, "UPDATE category_types SET name='Custom' WHERE id='bucket_essentials'", "INSERT INTO app_meta VALUES ('currency','USD')"])('seeds eligibility only for meaningful upgraded content: %s', async (customization) => {
		await runMigrations(db, migrations.filter(m => m.version <= 6));
		if (customization)
			await db.execute(customization);
		await runMigrations(db, migrations);
		expect(await revision()).toBe(customization ? 1 : 0);
	});
	it('tracks durable schedule progress but ignores timestamp-only updates', async () => {
		await runMigrations(db, migrations);
		await account();
		await db.execute("INSERT INTO schedules (id,name,kind,amount,account_id,frequency,start_date,created_at,updated_at) VALUES ('s','Rent','expense',100,'a','monthly','2026-10-26','x','x')");
		const before = await revision();
		await db.execute("UPDATE schedules SET next_due_date='2026-11-26',last_posted_date='2026-10-26',completed=1,errored_at='x'");
		expect(await revision()).toBeGreaterThan(before);
		const after = await revision();
		await db.execute("UPDATE schedules SET updated_at='later'");
		expect(await revision()).toBe(after);
	});
	it('requires automatic backup tables for current backups while keeping older backups compatible', async () => {
		await runMigrations(db, migrations.filter(m => m.version <= 6));
		expect(await validateDatabase(db, { min: 3, max: 7 })).toEqual({ valid: true, schemaVersion: 6 });
		await runMigrations(db, migrations);
		await db.execute('DROP TABLE automatic_backup_copies');
		expect(await validateDatabase(db, { min: 3, max: 7 })).toEqual({ valid: false, code: 'missing_table', schemaVersion: 7, table: 'automatic_backup_copies' });
	});
});
it('persists clock offsets across reopen and rolls them back without marking content', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'notchy-auto-offset-'));
	const path = join(dir, 'offset.sqlite');
	let fileDb = createTestDbFromPath(path);
	try {
		await runMigrations(fileDb, migrations);
		await fileDb.execute('UPDATE automatic_backup_state SET last_success_offset_minutes=420,pending_offset_minutes=420');
		await fileDb.execute("INSERT INTO automatic_backup_copies (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes) VALUES ('copy','owned.sqlite',7,0,'2026-10-26','2026-W44','2026-10-26T10:00:00Z','job',420)");
		await fileDb.close();
		fileDb = createTestDbFromPath(path);
		await expect(fileDb.transaction(async (tx) => {
			await tx.execute('UPDATE automatic_backup_state SET last_success_offset_minutes=-300,pending_offset_minutes=-300');
			await tx.execute('UPDATE automatic_backup_copies SET offset_minutes=-300');
			throw new Error('rollback');
		})).rejects.toThrow('rollback');
		expect(await fileDb.query('SELECT last_success_offset_minutes,pending_offset_minutes,content_revision FROM automatic_backup_state')).toEqual([{ last_success_offset_minutes: 420, pending_offset_minutes: 420, content_revision: 0 }]);
		expect(await fileDb.query('SELECT offset_minutes FROM automatic_backup_copies')).toEqual([{ offset_minutes: 420 }]);
	}
	finally {
		await fileDb.close();
		rmSync(dir, { recursive: true, force: true });
	}
});


import policyFixture from '../fixtures/automatic-backup-policy.json';
import { automaticBackupDue, automaticRetentionIds, automaticPruneClockTrusted } from '$lib/backup/automatic-policy';
describe('automatic backup policy', () => {
	it.each(policyFixture.eligibility)('applies daily changed-content eligibility: $name', ({ status, clock, due }) => {
		expect(automaticBackupDue(status, clock)).toBe(due);
	});
	it.each(policyFixture.clocks)('defers unsafe pruning: $name', ({ previous, current, trusted }) => {
		expect(automaticPruneClockTrusted(previous, current)).toBe(trusted);
	});
	it('retains_union_of_daily_weekly_and_schema_copies', () => {
		const { copies, protectedId, protected: protectedIds, deletions } = policyFixture.retention;
		const selected = automaticRetentionIds(copies, protectedId);
		expect(selected.sort()).toEqual([...deletions].sort());
		expect(selected.every(id => !protectedIds.includes(id))).toBe(true);
	});
});
