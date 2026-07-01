import type { DatabaseService } from '../service';

export async function getMeta(db: DatabaseService, key: string): Promise<string | null> {
	const rows = await db.query<{ value: string }>(`SELECT value FROM app_meta WHERE key = ?`, [key]);
	return rows[0]?.value ?? null;
}

export async function setMeta(db: DatabaseService, key: string, value: string): Promise<void> {
	await db.execute(
		`INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)`,
		[key, value]
	);
}

export async function deleteMeta(db: DatabaseService, key: string): Promise<void> {
	await db.execute(`DELETE FROM app_meta WHERE key = ?`, [key]);
}

export async function isFirstRunComplete(db: DatabaseService): Promise<boolean> {
	const val = await getMeta(db, 'first_run_complete');
	return val === '1';
}

export async function getLocale(db: DatabaseService): Promise<string> {
	return (await getMeta(db, 'locale')) ?? 'en';
}

export async function getCurrency(db: DatabaseService): Promise<string> {
	return (await getMeta(db, 'currency')) ?? 'VND';
}
