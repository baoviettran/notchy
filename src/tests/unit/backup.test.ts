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
