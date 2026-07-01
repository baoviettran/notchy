import type { DatabaseService } from '../service';
import { getMeta, setMeta } from './meta';
import { ulid } from '../../utils/id';

const KEY = 'csv_import_profiles';

export interface CsvImportProfile {
	id: string;
	name: string;
	delimiter: ',' | ';' | '\t' | '|';
	hasHeader: boolean;
	encoding: 'utf-8' | 'utf-8-bom' | 'windows-1252';
	mappings: {
		date?: number;
		amount?: number;
		payee?: number;
		description?: number;
	};
	defaults: {
		account_id: string;
		kind: 'expense' | 'income' | 'refund';
		tag_id?: string;
	};
}

interface StoredShape {
	version: number;
	profiles: CsvImportProfile[];
}

/** Apply forward-compatible defaults for fields missing on older stored profiles. */
function normalize(raw: Partial<CsvImportProfile>): CsvImportProfile {
	return {
		encoding: 'utf-8',
		mappings: {},
		defaults: { account_id: '', kind: 'expense' },
		...raw
	} as CsvImportProfile;
}

export async function getProfiles(db: DatabaseService): Promise<CsvImportProfile[]> {
	const blob = await getMeta(db, KEY);
	if (!blob) return [];
	try {
		const parsed = JSON.parse(blob) as StoredShape;
		if (!parsed || !Array.isArray(parsed.profiles)) return [];
		return parsed.profiles.map(normalize);
	} catch {
		return [];
	}
}

async function writeProfiles(db: DatabaseService, profiles: CsvImportProfile[]): Promise<void> {
	const blob: StoredShape = { version: 1, profiles };
	await setMeta(db, KEY, JSON.stringify(blob));
}

export async function saveProfile(
	db: DatabaseService,
	profile: CsvImportProfile | Omit<CsvImportProfile, 'id'>
): Promise<CsvImportProfile> {
	const stored = await getProfiles(db);
	const withId: CsvImportProfile =
		'id' in profile && profile.id ? (profile as CsvImportProfile) : { ...profile, id: ulid() };

	const idx = stored.findIndex((p) => p.id === withId.id);
	if (idx >= 0) stored[idx] = withId;
	else stored.push(withId);

	await writeProfiles(db, stored);
	return withId;
}

export async function deleteProfile(db: DatabaseService, id: string): Promise<void> {
	const stored = await getProfiles(db);
	const filtered = stored.filter((p) => p.id !== id);
	if (filtered.length === stored.length) return; // no-op if absent
	await writeProfiles(db, filtered);
}
