import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import type { DatabaseService } from '$lib/db';
import type { MetaOps } from '$lib/db/client';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { getBackupHealth } from '$lib/backup/health';

const OPTS = { appVersion: '0.1.4', databasePath: '/data/notchy.db', upgradeBackupDir: '/data/backups/upgrades' };

/** The health function takes the port's meta ops; the test handle is a bare service. */
const metaOf = (db: DatabaseService): MetaOps => new BrowserDatabaseClient(db).meta;

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('getBackupHealth', () => {
	it('reports a fresh database with all-null backup fields', async () => {
		expect(await getBackupHealth(metaOf(db), OPTS)).toEqual({
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

		const health = await getBackupHealth(metaOf(db), OPTS);

		expect(health.schemaVersion).toBe(6);
		expect(health.lastRoutineBackupAt).toBe('2026-08-01T00:00:00.000Z');
		expect(health.lastUpgradeBackupPath).toBe(upgradePath);
		expect(health.lastUpgradeFromSchema).toBe(4);
		expect(health.warning).toBe('Disk full');
	});

	it('falls back to 0 when schema_version is non-numeric', async () => {
		await db.execute(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', 'not-a-number')`);
		const health = await getBackupHealth(metaOf(db), OPTS);
		expect(health.schemaVersion).toBe(0);
	});

	it('queries only app_meta rows, never financial tables', async () => {
		const statements: string[] = [];
		const originalQuery = db.query.bind(db);
		db.query = (async (sql: string, params?: unknown[]) => {
			statements.push(sql);
			return originalQuery(sql, params);
		}) as typeof db.query;

		await getBackupHealth(metaOf(db), OPTS);

		expect(statements.length).toBeGreaterThan(0);
		for (const statement of statements) {
			expect(statement.toLowerCase()).toContain('app_meta');
		}
	});
});

describe('getBackupHealth reads only app_meta', () => {
	it('does not require a raw database handle', async () => {
		const meta = { get: async (key: string) => (key === 'schema_version' ? '6' : null) };

		const health = await getBackupHealth(meta as never, OPTS);

		expect(health.schemaVersion).toBe(6);
		expect(health.lastRoutineBackupAt).toBeNull();
	});
});
