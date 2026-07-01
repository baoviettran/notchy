import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import {
	getProfiles,
	saveProfile,
	deleteProfile,
	type CsvImportProfile
} from '$lib/db/repos/csvImportProfiles';
import type { DatabaseService } from '$lib/db/service';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
});

const baseProfile = (): Omit<CsvImportProfile, 'id'> => ({
	name: 'Vietcombank checking',
	delimiter: ',',
	hasHeader: true,
	encoding: 'utf-8',
	mappings: { date: 0, amount: 2, payee: 1 },
	defaults: { account_id: 'acc1', kind: 'expense' }
});

describe('getProfiles', () => {
	it('returns [] when no profiles are stored', async () => {
		expect(await getProfiles(db)).toEqual([]);
	});
});

describe('saveProfile', () => {
	it('assigns an id and round-trips the profile', async () => {
		const saved = await saveProfile(db, baseProfile());
		expect(saved.id).toBeTruthy();

		const all = await getProfiles(db);
		expect(all).toHaveLength(1);
		expect(all[0]).toEqual(saved);
		expect(all[0].name).toBe('Vietcombank checking');
		expect(all[0].defaults.account_id).toBe('acc1');
	});

	it('appends additional profiles without overwriting existing ones', async () => {
		await saveProfile(db, baseProfile());
		const second = await saveProfile(db, { ...baseProfile(), name: 'Cash' });
		const all = await getProfiles(db);
		expect(all).toHaveLength(2);
		expect(all.map((p) => p.name).sort()).toEqual(['Cash', 'Vietcombank checking']);
		expect(all.some((p) => p.id === second.id)).toBe(true);
	});

	it('updates an existing profile when id is provided', async () => {
		const saved = await saveProfile(db, baseProfile());
		await saveProfile(db, { ...saved, name: 'VCB renamed', delimiter: ';' });
		const all = await getProfiles(db);
		expect(all).toHaveLength(1);
		expect(all[0].name).toBe('VCB renamed');
		expect(all[0].delimiter).toBe(';');
	});

	it('tolerates older profiles missing optional fields (forward-compatible)', async () => {
		// Simulate a profile written before `encoding` existed: omit the field entirely.
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('csv_import_profiles', ?)`,
			[JSON.stringify({
				version: 1,
				profiles: [
					{ id: 'old1', name: 'Old', delimiter: ',', hasHeader: true, mappings: {}, defaults: { account_id: 'acc1', kind: 'expense' } }
				]
			})]
		);
		const all = await getProfiles(db);
		expect(all).toHaveLength(1);
		// Missing optional `encoding` defaults to utf-8 rather than throwing.
		expect(all[0].encoding).toBe('utf-8');
	});

	it('tolerates a profile missing the defaults object (forward-compatible)', async () => {
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('csv_import_profiles', ?)`,
			[JSON.stringify({
				version: 1,
				profiles: [{ id: 'nohdef', name: 'NoDefaults', delimiter: ',', hasHeader: true, mappings: { amount: 0 } }]
			})]
		);
		const all = await getProfiles(db);
		expect(all).toHaveLength(1);
		expect(all[0].defaults.account_id).toBe('');
		expect(all[0].defaults.kind).toBe('expense');
	});
});

describe('deleteProfile', () => {
	it('removes a profile by id', async () => {
		const saved = await saveProfile(db, baseProfile());
		await deleteProfile(db, saved.id);
		expect(await getProfiles(db)).toEqual([]);
	});

	it('is a no-op when the id is absent', async () => {
		await saveProfile(db, baseProfile());
		await deleteProfile(db, 'does-not-exist');
		expect(await getProfiles(db)).toHaveLength(1);
	});
});
