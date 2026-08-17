import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTestDbFromPath } from './helpers/test-db';
import type { DatabaseService } from '$lib/db';
import { validateDatabase } from '$lib/backup/validation';
import {
	restoreCompatibleDatabase,
	buildTechnicalReport,
	type RestoreDependencies
} from '$lib/recovery';
import { MIN_SUPPORTED_SCHEMA_VERSION, LATEST_SCHEMA_VERSION, migrations } from '$lib/db/migrations/index';
import { runMigrations } from '$lib/db/migrations/runner';

// Released v0.1.1 fixture (schema 4). Copied to a temp dir before opening —
// the committed fixture must never be opened for writing.
const V004_FIXTURE = fileURLToPath(new URL('../fixtures/migrations/v004.sqlite', import.meta.url));

function makeDependencies(replaceLiveDatabase: ReturnType<typeof vi.fn>): RestoreDependencies {
	return {
		openReadOnly: async (path: string) => createTestDbFromPath(path),
		replaceLiveDatabase
	};
}

/** Copy the released v004 fixture into the per-test temp dir and open it writable. */
function openFixtureCopy(name: string): { path: string; db: ReturnType<typeof createTestDbFromPath> } {
	const path = join(tmpDir, name);
	copyFileSync(V004_FIXTURE, path);
	return { path, db: createTestDbFromPath(path) };
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), 'notchy-recovery-'));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateDatabase range policy', () => {
	it('accepts a released older backup and returns its version for forward migration', async () => {
		const { db } = openFixtureCopy('v004.sqlite');
		try {
			const result = await validateDatabase(db, {
				min: MIN_SUPPORTED_SCHEMA_VERSION,
				max: LATEST_SCHEMA_VERSION
			});
			expect(result).toEqual({ valid: true, schemaVersion: 4 });
		} finally {
			await db.close();
		}
	});

	it('rejects a newer backup (schema 6) outside the supported range', async () => {
		const { db } = openFixtureCopy('newer.sqlite');
		try {
			await db.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
			const result = await validateDatabase(db, {
				min: MIN_SUPPORTED_SCHEMA_VERSION,
				max: LATEST_SCHEMA_VERSION
			});
			expect(result).toEqual({ valid: false, code: 'schema_newer', schemaVersion: 6 });
		} finally {
			await db.close();
		}
	});

	it('rejects a too-old backup (schema 2) below the supported minimum', async () => {
		const { db } = openFixtureCopy('tooold.sqlite');
		try {
			await db.execute("UPDATE app_meta SET value = '2' WHERE key = 'schema_version'");
			const result = await validateDatabase(db, {
				min: MIN_SUPPORTED_SCHEMA_VERSION,
				max: LATEST_SCHEMA_VERSION
			});
			expect(result).toEqual({ valid: false, code: 'schema_too_old', schemaVersion: 2 });
		} finally {
			await db.close();
		}
	});
});

describe('restoreCompatibleDatabase', () => {
	it('restores a compatible older backup and reports its schema version', async () => {
		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		let candidate: DatabaseService | undefined;
		const dependencies: RestoreDependencies = {
			openReadOnly: async (path: string) => {
				candidate = createTestDbFromPath(path);
				return candidate;
			},
			replaceLiveDatabase
		};
		const v004Path = join(tmpDir, 'v004.sqlite');
		copyFileSync(V004_FIXTURE, v004Path);

		const result = await restoreCompatibleDatabase(v004Path, dependencies);

		expect(result).toEqual({ schemaVersion: 4 });
		expect(replaceLiveDatabase).toHaveBeenCalledWith(v004Path);
		// The candidate is intentionally left open: tauri-plugin-sql's close hangs
		// on this sqlx version and would deadlock later loads. It is only read
		// during validation, so leaving it open is a bounded leak, not a data
		// hazard — prove it is still queryable (open), never written by the app.
		expect((await candidate!.query('SELECT 1')).length).toBeGreaterThan(0);
	});

	it('rejects a newer backup before replacing the live file', async () => {
		const { path: newerPath, db: newerDb } = openFixtureCopy('newer.sqlite');
		await newerDb.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
		await newerDb.close();

		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		const dependencies = makeDependencies(replaceLiveDatabase);

		await expect(restoreCompatibleDatabase(newerPath, dependencies)).rejects.toMatchObject({
			code: 'backup_schema_newer'
		});
		expect(replaceLiveDatabase).not.toHaveBeenCalled();
	});

	it('rejects a too-old backup before replacing the live file', async () => {
		const { path: tooOldPath, db: tooOldDb } = openFixtureCopy('tooold.sqlite');
		await tooOldDb.execute("UPDATE app_meta SET value = '2' WHERE key = 'schema_version'");
		await tooOldDb.close();

		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		const dependencies = makeDependencies(replaceLiveDatabase);

		await expect(restoreCompatibleDatabase(tooOldPath, dependencies)).rejects.toMatchObject({
			code: 'backup_schema_too_old'
		});
		expect(replaceLiveDatabase).not.toHaveBeenCalled();
	});

	it('rejects a corrupt backup before replacing the live file', async () => {
		const corruptPath = join(tmpDir, 'corrupt.sqlite');
		const source = createTestDbFromPath(corruptPath);
		await source.execute('CREATE TABLE t (x INTEGER)');
		for (let i = 0; i < 50; i++) await source.execute('INSERT INTO t VALUES (?)', [i]);
		await source.close();
		// Truncate the tail so the file reopens but PRAGMA integrity_check
		// reports corruption instead of 'ok'.
		const bytes = readFileSync(corruptPath);
		writeFileSync(corruptPath, bytes.subarray(0, bytes.length - 512));

		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		const dependencies = makeDependencies(replaceLiveDatabase);

		await expect(restoreCompatibleDatabase(corruptPath, dependencies)).rejects.toMatchObject({
			code: 'backup_corrupt'
		});
		expect(replaceLiveDatabase).not.toHaveBeenCalled();
	});

	it('rejects a database missing its schema version before replacing the live file', async () => {
		const missingPath = join(tmpDir, 'missing.sqlite');
		const db = createTestDbFromPath(missingPath);
		await db.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await db.close();

		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		const dependencies = makeDependencies(replaceLiveDatabase);

		await expect(restoreCompatibleDatabase(missingPath, dependencies)).rejects.toMatchObject({
			code: 'backup_missing_schema_version'
		});
		expect(replaceLiveDatabase).not.toHaveBeenCalled();
	});

	it('rejects a database missing a required table before replacing the live file', async () => {
		const missingTablePath = join(tmpDir, 'missing-table.sqlite');
		const db = createTestDbFromPath(missingTablePath);
		await runMigrations(db, migrations);
		await db.execute('DROP TABLE category_tags');
		await db.close();

		const replaceLiveDatabase = vi.fn(async (_sourcePath: string) => {});
		const dependencies = makeDependencies(replaceLiveDatabase);

		await expect(restoreCompatibleDatabase(missingTablePath, dependencies)).rejects.toMatchObject({
			code: 'backup_missing_table'
		});
		expect(replaceLiveDatabase).not.toHaveBeenCalled();
	});
});

describe('buildTechnicalReport', () => {
	it('redacts detail and financial values from the copyable report', () => {
		const report = buildTechnicalReport({
			code: 'migration_failed',
			appVersion: '0.1.4',
			latestSchemaVersion: 5,
			detectedSchemaVersion: 4,
			liveDatabasePath: '/data/notchy.db',
			backupPath: '/data/backups/safe.sqlite',
			detail: 'SQLITE_ERROR while migrating 005; payee=Private Clinic; amount=900000'
		});
		expect(report).toContain('migration_failed');
		expect(report).toContain('0.1.4');
		expect(report).not.toContain('Private Clinic');
		expect(report).not.toContain('900000');
	});
});
