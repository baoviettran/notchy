import type { DatabaseService } from './service';

export type SchemaInspection =
	| { kind: 'fresh' }
	| { kind: 'older'; version: number }
	| { kind: 'current'; version: number }
	| { kind: 'newer'; version: number }
	| { kind: 'invalid'; reason: 'missing_schema_version' | 'invalid_schema_version' };

export async function inspectSchema(
	db: DatabaseService,
	latestVersion: number
): Promise<SchemaInspection> {
	const tables = await db.query<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	);
	if (tables.length === 0) return { kind: 'fresh' };
	if (!tables.some((row) => row.name === 'app_meta')) {
		return { kind: 'invalid', reason: 'missing_schema_version' };
	}

	const rows = await db.query<{ value: string }>(
		"SELECT value FROM app_meta WHERE key = 'schema_version'"
	);
	if (rows.length !== 1) return { kind: 'invalid', reason: 'missing_schema_version' };

	const version = Number(rows[0].value);
	if (!Number.isInteger(version) || version < 1) {
		return { kind: 'invalid', reason: 'invalid_schema_version' };
	}
	if (version < latestVersion) return { kind: 'older', version };
	if (version > latestVersion) return { kind: 'newer', version };
	return { kind: 'current', version };
}
