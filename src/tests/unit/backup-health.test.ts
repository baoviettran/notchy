import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db/service';
import { getBackupHealth, createManualBackup } from '$lib/backup/health';

const OPTS = { appVersion: '0.1.4', databasePath: '/data/notchy.db', upgradeBackupDir: '/data/backups/upgrades' };

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('getBackupHealth', () => {
	it('reports a fresh database with all-null backup fields', async () => {
		expect(await getBackupHealth(db, OPTS)).toEqual({
			appVersion: '0.1.4',
			schemaVersion: 5,
			databasePath: '/data/notchy.db',
			lastRoutineBackupAt: null,
			lastUpgradeBackupPath: null,
			lastUpgradeFromSchema: null,
			warning: null
		});
	});

	it('surfaces each seeded metadata key without reading financial tables', async () => {
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '6')`);
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_backup_at', '2026-08-01T00:00:00.000Z')`);
		const upgradePath = '/data/backups/upgrades/notchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-01T00-00-00-000Z.sqlite';
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_upgrade_backup_path', ?)`, [upgradePath]);
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_migrated_from_schema', '4')`);
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('backup_warning', 'Disk full')`);

		const health = await getBackupHealth(db, OPTS);

		expect(health.schemaVersion).toBe(6);
		expect(health.lastRoutineBackupAt).toBe('2026-08-01T00:00:00.000Z');
		expect(health.lastUpgradeBackupPath).toBe(upgradePath);
		expect(health.lastUpgradeFromSchema).toBe(4);
		expect(health.warning).toBe('Disk full');
	});

	it('falls back to 0 when schema_version is non-numeric', async () => {
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', 'not-a-number')`);
		const health = await getBackupHealth(db, OPTS);
		expect(health.schemaVersion).toBe(0);
	});

	it('queries only app_meta rows, never financial tables', async () => {
		const statements: string[] = [];
		const originalQuery = db.query.bind(db);
		db.query = (async (sql: string, params?: unknown[]) => {
			statements.push(sql);
			return originalQuery(sql, params);
		}) as typeof db.query;

		await getBackupHealth(db, OPTS);

		expect(statements.length).toBeGreaterThan(0);
		for (const statement of statements) {
			expect(statement.toLowerCase()).toContain('app_meta');
		}
	});
});

describe('createManualBackup', () => {
	it('writes a real backup file and records last_backup_at', async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), 'notchy-health-'));
		try {
			const path = await createManualBackup(db, { backupDir: tmpDir, ensureDirectory: async () => {} });

			expect(path.startsWith(tmpDir)).toBe(true);
			expect(path.endsWith('.sqlite')).toBe(true);
			expect(existsSync(path)).toBe(true);

			const backup = new BetterSqlite3(path, { readonly: true });
			try {
				const row = backup.prepare('SELECT COUNT(*) AS c FROM app_meta').get() as { c: number };
				expect(row.c).toBeGreaterThan(0);
			} finally {
				backup.close();
			}

			const meta = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'last_backup_at'`);
			expect(meta).toHaveLength(1);
			expect(Number.isNaN(new Date(meta[0].value).getTime())).toBe(false);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('leaves last_backup_at unchanged when the backup fails', async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), 'notchy-health-fail-'));
		try {
			const missingDir = join(tmpDir, 'missing');
			await expect(
				createManualBackup(db, { backupDir: missingDir, ensureDirectory: async () => {} })
			).rejects.toThrow();

			const meta = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'last_backup_at'`);
			expect(meta).toHaveLength(0);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
