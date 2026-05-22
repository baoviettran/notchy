import type { DatabaseService } from '../service';

export interface Migration {
	version: number;
	name: string;
	up(db: DatabaseService): Promise<void>;
}

export async function runMigrations(db: DatabaseService, migrations: Migration[]): Promise<void> {
	await db.execute(`
		CREATE TABLE IF NOT EXISTS app_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);

	const rows = await db.query<{ value: string }>(
		`SELECT value FROM app_meta WHERE key = 'schema_version'`
	);
	const currentVersion = rows.length > 0 ? parseInt(rows[0].value, 10) : 0;

	const pending = migrations
		.filter((m) => m.version > currentVersion)
		.sort((a, b) => a.version - b.version);

	for (const migration of pending) {
		await db.transaction(async (tx) => {
			await migration.up(tx);
			await tx.execute(
				`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)`,
				[String(migration.version)]
			);
		});
	}
}
