import type { DatabaseService } from '$lib/db/service';

export type SchemaPolicy = { exact: number } | { min: number; max: number };

export type DatabaseValidation =
	| { valid: true; schemaVersion: number }
	| {
			valid: false;
			code:
				| 'corrupt'
				| 'missing_schema_version'
				| 'schema_too_old'
				| 'schema_newer'
				| 'schema_mismatch'
				| 'missing_table';
			schemaVersion?: number;
			table?: string;
	  };

const REQUIRED_TABLES = ['accounts', 'transactions', 'category_types', 'category_tags', 'app_meta'] as const;

export async function validateDatabase(
	db: DatabaseService,
	policy: SchemaPolicy
): Promise<DatabaseValidation> {
	try {
		const integrity = await db.query<{ integrity_check: string }>('PRAGMA integrity_check');
		if (integrity[0].integrity_check !== 'ok') {
			return { valid: false, code: 'corrupt' };
		}
	} catch {
		return { valid: false, code: 'corrupt' };
	}

	let rows: { value: string }[];
	try {
		rows = await db.query<{ value: string }>(
			"SELECT value FROM app_meta WHERE key = 'schema_version'"
		);
	} catch {
		return { valid: false, code: 'missing_schema_version' };
	}
	if (rows.length !== 1 || !Number.isInteger(Number(rows[0].value))) {
		return { valid: false, code: 'missing_schema_version' };
	}

	const schemaVersion = Number(rows[0].value);
	if ('exact' in policy && schemaVersion !== policy.exact) {
		return { valid: false, code: 'schema_mismatch', schemaVersion };
	}
	if ('min' in policy && schemaVersion < policy.min) {
		return { valid: false, code: 'schema_too_old', schemaVersion };
	}
	if ('max' in policy && schemaVersion > policy.max) {
		return { valid: false, code: 'schema_newer', schemaVersion };
	}

	const tables = new Set(
		(await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'"))
			.map((row) => row.name)
	);
	for (const table of REQUIRED_TABLES) {
		if (!tables.has(table)) {
			return { valid: false, code: 'missing_table', schemaVersion, table };
		}
	}

	return { valid: true, schemaVersion };
}
