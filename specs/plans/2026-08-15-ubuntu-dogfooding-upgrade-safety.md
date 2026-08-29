# Ubuntu Dogfooding and Upgrade Safety Implementation Plan
**Serves:** STORY-015

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Notchy 0.1.4 safe to install over an earlier Ubuntu `.deb` while preserving a real user database and a verified pre-upgrade recovery point.

**Architecture:** Split database startup into schema inspection, mandatory upgrade backup, transactional migration, and post-migration verification services coordinated by the main window. Keep recovery and release tooling outside the finance repositories; finance routes render only after startup reaches `ready`, while the quick-add window may open only a current-schema database.

**Tech Stack:** SvelteKit 5 runes, TypeScript 5.8, Tauri v2, `@tauri-apps/plugin-sql`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-opener`, SQLite, Vitest 3, Playwright, Node 22.22.3, pnpm 10.11.0, Rust 1.77.2.

## Global Constraints

- Follow [the approved design](../2026-08-15-ubuntu-dogfooding-upgrade-safety-design.md).
- Keep money as integer smallest-currency units; no financial values may enter recovery reports or logs.
- Keep `com.notchy.app` unchanged so Ubuntu package upgrades reuse the same application-data directory.
- Support forward migration from every released fixture in `src/tests/fixtures/migrations/`; schemas newer than the application are read-only rejection cases.
- Do not implement down migrations or automatic restore after migration failure.
- A routine launch backup remains best-effort; a pre-migration backup is mandatory and verified before the first migration executes.
- Only the main window may migrate. The quick-add window must show an update-required error until the main window finishes.
- Add all user-facing copy to both `messages/en.json` and `messages/vi.json`; never edit generated `src/lib/paraglide/` files.
- Use real SQLite for database tests and write the failing test before implementation.
- Use tabs, single quotes, Svelte 5 runes, focused modules, and existing `AppError`/`mapError` conventions.
- Release target for this work is application version `0.1.4`; current latest schema remains `5`.

---

## File Map

### New files

- `src/lib/db/schema.ts` — classifies a database as fresh, older, current, newer, or invalid without mutating it.
- `src/lib/backup/validation.ts` — validates integrity, required tables, and an allowed schema-version policy.
- `src/lib/backup/upgrade.ts` — creates, verifies, names, lists, and retains mandatory pre-upgrade backups.
- `src/lib/db/startup.ts` — coordinates inspection, backup, migration, verification, metadata, and recovery context.
- `src/lib/db/platform.ts` — Tauri-specific app-data paths, application version, directory operations, and read-only database opening.
- `src/lib/recovery.ts` — restore policy, sanitized technical reports, and recovery actions independent of Svelte UI.
- `src/lib/components/system/RecoveryScreen.svelte` — blocking recovery UI shown before finance routes.
- `src/tests/unit/schema.test.ts` — schema classification tests.
- `src/tests/unit/upgrade-backup.test.ts` — real-SQLite mandatory backup and retention tests.
- `src/tests/unit/startup.test.ts` — coordinator order, failure, rollback, and metadata tests.
- `src/tests/unit/recovery.test.ts` — restore compatibility and report-redaction tests.
- `src/tests/unit/components/RecoveryScreen.test.ts` — recovery action and accessible-state tests.
- `scripts/release-dogfood.mjs` — version gate, verification commands, `.deb` artifact normalization, and checksum creation.
- `scripts/release-dogfood.test.mjs` — Node tests for version and artifact logic.
- `src/tests/e2e/startup-recovery.spec.ts` — browser/Tauri-mock coverage for blocking recovery behavior.

### Modified files

- `src/lib/db/migrations/index.ts` — export `LATEST_SCHEMA_VERSION` and `MIN_SUPPORTED_SCHEMA_VERSION`.
- `src/lib/db/index.ts` — separate main-window initialization from current-schema access.
- `src/lib/db/migrations/runner.ts` — reject newer schemas and expose migration progress.
- `src/lib/backup/index.ts` — re-export focused backup modules and use version policies for import.
- `src/lib/stores/db.svelte.ts` — expose startup stage, recovery context, retry, and health information.
- `src/routes/+layout.svelte` — render preparing and recovery states before onboarding or the app shell.
- `src/routes/quick-add/+page.svelte` — render update-required state when schema initialization is pending.
- `src/routes/settings/backup/+page.svelte` — show app/schema/path/backup health and create/open-backup actions.
- `src/tests/unit/backup.test.ts` — adapt import validation to version policies.
- `src/tests/unit/migrations.test.ts` — assert latest-version constant and preserved released fixtures.
- `src/tests/e2e/fixtures/tauri-mock.ts` — support startup schema seeding and opener calls.
- `src/tests/e2e/backup-restore.spec.ts` — cover older supported restore and newer rejection.
- `stryker.db.conf.mjs` — include schema inspection, upgrade backup, startup, and recovery services in database mutation targets.
- `messages/en.json`, `messages/vi.json` — startup, recovery, health, and manual-backup copy.
- `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` — initialize and permit the official opener plugin plus a quit command.
- `package.json`, `src-tauri/tauri.conf.json` — add opener dependency, release scripts, and synchronized version `0.1.4`.
- `specs/2026-07-27-desktop-release-smoke-checklist.md` — record source/target schema and pre-upgrade backup evidence.
- `specs/notes/2026-08-15-v0.1.4.md` — dogfood release notes and Ubuntu upgrade instructions.

---

### Task 1: Read-only schema inspection and version constants

**Files:**
- Create: `src/lib/db/schema.ts`
- Create: `src/tests/unit/schema.test.ts`
- Modify: `src/lib/db/migrations/index.ts`
- Modify: `src/lib/db/migrations/runner.ts`
- Modify: `src/tests/unit/migrations.test.ts`

**Interfaces:**
- Produces: `LATEST_SCHEMA_VERSION: number`, `MIN_SUPPORTED_SCHEMA_VERSION: number`.
- Produces: `inspectSchema(db, latestVersion): Promise<SchemaInspection>`.
- Produces: `runMigrations(db, migrations, onMigration?): Promise<void>` with a progress callback.
- Consumes: existing `DatabaseService` and `Migration` interfaces.

- [x] **Step 1: Write failing schema-inspection tests**

Create `src/tests/unit/schema.test.ts` with real SQLite cases:

```ts
import { describe, expect, it } from 'vitest';
import { inspectSchema } from '$lib/db/schema';
import { createTestDb } from './helpers/test-db';

describe('inspectSchema', () => {
	it('classifies an empty database as fresh', async () => {
		expect(await inspectSchema(createTestDb(), 5)).toEqual({ kind: 'fresh' });
	});

	it('classifies supported older, current, and newer versions without writing', async () => {
		for (const [version, kind] of [[4, 'older'], [5, 'current'], [6, 'newer']] as const) {
			const db = createTestDb();
			await db.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
			await db.execute("INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)", [String(version)]);
			expect(await inspectSchema(db, 5)).toEqual({ kind, version });
		}
	});

	it('rejects an existing database with missing or malformed schema metadata', async () => {
		const missing = createTestDb();
		await missing.execute('CREATE TABLE accounts (id TEXT PRIMARY KEY)');
		expect(await inspectSchema(missing, 5)).toEqual({ kind: 'invalid', reason: 'missing_schema_version' });

		const malformed = createTestDb();
		await malformed.execute('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		await malformed.execute("INSERT INTO app_meta VALUES ('schema_version', 'five')");
		expect(await inspectSchema(malformed, 5)).toEqual({ kind: 'invalid', reason: 'invalid_schema_version' });
	});
});
```

- [x] **Step 2: Run the schema tests and confirm the red state**

Run: `pnpm vitest run src/tests/unit/schema.test.ts`

Expected: FAIL because `$lib/db/schema` does not exist.

- [x] **Step 3: Implement the read-only classifier and constants**

Create `src/lib/db/schema.ts` with this public contract:

```ts
import type { DatabaseService } from './service';

export type SchemaInspection =
	| { kind: 'fresh' }
	| { kind: 'older'; version: number }
	| { kind: 'current'; version: number }
	| { kind: 'newer'; version: number }
	| { kind: 'invalid'; reason: 'missing_schema_version' | 'invalid_schema_version' };

export async function inspectSchema(db: DatabaseService, latestVersion: number): Promise<SchemaInspection> {
	const tables = await db.query<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	);
	if (tables.length === 0) return { kind: 'fresh' };
	if (!tables.some((row) => row.name === 'app_meta')) {
		return { kind: 'invalid', reason: 'missing_schema_version' };
	}
	const rows = await db.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'");
	if (rows.length !== 1) return { kind: 'invalid', reason: 'missing_schema_version' };
	const version = Number(rows[0].value);
	if (!Number.isInteger(version) || version < 1) return { kind: 'invalid', reason: 'invalid_schema_version' };
	if (version < latestVersion) return { kind: 'older', version };
	if (version > latestVersion) return { kind: 'newer', version };
	return { kind: 'current', version };
}
```

In `src/lib/db/migrations/index.ts`, derive rather than duplicate the latest version:

```ts
export const LATEST_SCHEMA_VERSION = Math.max(...migrations.map((migration) => migration.version));
export const MIN_SUPPORTED_SCHEMA_VERSION = 3;
```

- [x] **Step 4: Make the migration runner reject newer schemas and report progress**

Change the runner signature and add the guard before filtering pending migrations:

```ts
export async function runMigrations(
	db: DatabaseService,
	migrations: Migration[],
	onMigration: (migration: Migration) => void = () => {}
): Promise<void> {
	// existing app_meta creation and version read
	const latest = Math.max(...migrations.map((migration) => migration.version));
	if (currentVersion > latest) {
		throw new Error(`database_schema_newer:${currentVersion}:${latest}`);
	}
	for (const migration of pending) {
		onMigration(migration);
		await db.transaction(async (tx) => {
			await migration.up(tx);
			await tx.execute(
				"INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)",
				[String(migration.version)]
			);
		});
	}
}
```

Keep the existing `CREATE TABLE app_meta` and pending-sort logic around this code.

- [x] **Step 5: Extend migration tests for constants, progress, and newer rejection**

Add assertions to `src/tests/unit/migrations.test.ts`:

```ts
it('derives the latest schema version from the registry', () => {
	expect(LATEST_SCHEMA_VERSION).toBe(5);
});

it('reports each applied migration in order', async () => {
	const fresh = createTestDb();
	const seen: number[] = [];
	await runMigrations(fresh, migrations, (migration) => seen.push(migration.version));
	expect(seen).toEqual([1, 2, 3, 4, 5]);
});

it('does not modify a database from a newer schema', async () => {
	await db.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
	await expect(runMigrations(db, migrations)).rejects.toThrow('database_schema_newer:6:5');
	expect(await db.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'"))
		.toEqual([{ value: '6' }]);
});
```

- [x] **Step 6: Run focused and full migration tests**

Run: `pnpm vitest run src/tests/unit/schema.test.ts src/tests/unit/migrations.test.ts`

Expected: both files PASS; released `v003.sqlite` and `v004.sqlite` fixtures still preserve their seeded rows.

- [x] **Step 7: Commit Task 1**

```sh
git add src/lib/db/schema.ts src/lib/db/migrations/index.ts src/lib/db/migrations/runner.ts src/tests/unit/schema.test.ts src/tests/unit/migrations.test.ts
git commit -m "feat(db): inspect schema before migrations"
```

---

### Task 2: Database validation and mandatory upgrade backups

**Files:**
- Create: `src/lib/backup/validation.ts`
- Create: `src/lib/backup/upgrade.ts`
- Create: `src/tests/unit/upgrade-backup.test.ts`
- Modify: `src/lib/backup/index.ts`
- Modify: `src/tests/unit/backup.test.ts`

**Interfaces:**
- Consumes: `createBackup(db, backupDir)` and schema constants from Task 1.
- Produces: `validateDatabase(db, policy): Promise<DatabaseValidation>`.
- Produces: `createVerifiedUpgradeBackup(db, options): Promise<UpgradeBackupRecord>`.
- Produces: `getUpgradeBackupsToDelete(records, keepPerSource?): string[]`.

- [x] **Step 1: Write failing validation-policy tests**

Move validation expectations out of `backup.test.ts` and cover exact/range policies:

```ts
describe('validateDatabase', () => {
	it('accepts an exact source schema for upgrade verification', async () => {
		expect(await validateDatabase(db, { exact: 5 })).toEqual({ valid: true, schemaVersion: 5 });
	});

	it('accepts supported older backups and rejects newer backups', async () => {
		await db.execute("UPDATE app_meta SET value = '4' WHERE key = 'schema_version'");
		expect(await validateDatabase(db, { min: 3, max: 5 })).toEqual({ valid: true, schemaVersion: 4 });
		await db.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
		expect(await validateDatabase(db, { min: 3, max: 5 })).toEqual({
			valid: false, code: 'schema_newer', schemaVersion: 6
		});
	});
});
```

- [x] **Step 2: Write failing real-file upgrade-backup tests**

In `src/tests/unit/upgrade-backup.test.ts`, copy `v004.sqlite` to a temp directory, open it with `createTestDbFromPath`, call the new service, and assert:

```ts
const record = await createVerifiedUpgradeBackup(sourceDb, {
	backupDir,
	sourceSchema: 4,
	targetSchema: 5,
	sourceAppVersion: '0.1.3',
	createdAt: new Date('2026-08-15T10:30:00.000Z'),
	openReadOnly: async (path) => createTestDbFromPath(path)
});
expect(record).toMatchObject({ sourceSchema: 4, targetSchema: 5, verified: true });
expect(record.path).toContain('notchy-pre-upgrade-v4-to-v5-0.1.3-2026-08-15T10-30-00-000Z.sqlite');
```

Also inject `openReadOnly` returning a corrupt database and assert rejection occurs before any migration callback can run.

- [x] **Step 3: Run the new backup tests and confirm the red state**

Run: `pnpm vitest run src/tests/unit/backup.test.ts src/tests/unit/upgrade-backup.test.ts`

Expected: FAIL because `validation.ts` and `upgrade.ts` do not exist.

- [x] **Step 4: Implement structured database validation**

Create `src/lib/backup/validation.ts`:

```ts
import type { DatabaseService } from '$lib/db/service';

export type SchemaPolicy = { exact: number } | { min: number; max: number };
export type DatabaseValidation =
	| { valid: true; schemaVersion: number }
	| { valid: false; code: 'corrupt' | 'missing_schema_version' | 'schema_too_old' | 'schema_newer' | 'schema_mismatch' | 'missing_table'; schemaVersion?: number; table?: string };

const REQUIRED_TABLES = ['accounts', 'transactions', 'category_types', 'category_tags', 'app_meta'] as const;

export async function validateDatabase(db: DatabaseService, policy: SchemaPolicy): Promise<DatabaseValidation> {
	const integrity = await db.query<{ integrity_check: string }>('PRAGMA integrity_check');
	if (integrity[0]?.integrity_check !== 'ok') return { valid: false, code: 'corrupt' };
	const rows = await db.query<{ value: string }>("SELECT value FROM app_meta WHERE key = 'schema_version'").catch(() => []);
	if (rows.length !== 1 || !Number.isInteger(Number(rows[0].value))) return { valid: false, code: 'missing_schema_version' };
	const schemaVersion = Number(rows[0].value);
	if ('exact' in policy && schemaVersion !== policy.exact) return { valid: false, code: 'schema_mismatch', schemaVersion };
	if ('min' in policy && schemaVersion < policy.min) return { valid: false, code: 'schema_too_old', schemaVersion };
	if ('max' in policy && schemaVersion > policy.max) return { valid: false, code: 'schema_newer', schemaVersion };
	const tables = new Set((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name));
	for (const table of REQUIRED_TABLES) if (!tables.has(table)) return { valid: false, code: 'missing_table', schemaVersion, table };
	return { valid: true, schemaVersion };
}
```

- [x] **Step 5: Implement verified upgrade backup creation and retention**

Create `src/lib/backup/upgrade.ts` with these public types and functions:

```ts
import type { DatabaseService } from '$lib/db/service';
import { AppError } from '$lib/errors';
import { validateDatabase } from './validation';

export interface UpgradeBackupRecord {
	path: string;
	createdAt: string;
	sourceSchema: number;
	targetSchema: number;
	sourceAppVersion: string;
	verified: true;
}

export interface CreateUpgradeBackupOptions {
	backupDir: string;
	sourceSchema: number;
	targetSchema: number;
	sourceAppVersion: string;
	createdAt: Date;
	openReadOnly(path: string): Promise<DatabaseService>;
}

export async function createVerifiedUpgradeBackup(
	db: DatabaseService,
	options: CreateUpgradeBackupOptions
): Promise<UpgradeBackupRecord> {
	const stamp = options.createdAt.toISOString().replace(/[:.]/g, '-');
	const safeVersion = options.sourceAppVersion.replace(/[^0-9A-Za-z.-]/g, '_');
	const filename = `notchy-pre-upgrade-v${options.sourceSchema}-to-v${options.targetSchema}-${safeVersion}-${stamp}.sqlite`;
	const path = `${options.backupDir}/${filename}`;
	await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
	const backupDb = await options.openReadOnly(path);
	try {
		const validation = await validateDatabase(backupDb, { exact: options.sourceSchema });
		if (!validation.valid) throw new AppError('upgrade_backup_verification_failed', { code: validation.code });
	} finally {
		await backupDb.close();
	}
	return { path, createdAt: options.createdAt.toISOString(), sourceSchema: options.sourceSchema, targetSchema: options.targetSchema, sourceAppVersion: options.sourceAppVersion, verified: true };
}

export function getUpgradeBackupsToDelete(records: UpgradeBackupRecord[], keepPerSource = 2): string[] {
	const bySource = new Map<number, UpgradeBackupRecord[]>();
	for (const record of records) {
		bySource.set(record.sourceSchema, [...(bySource.get(record.sourceSchema) ?? []), record]);
	}
	return [...bySource.values()].flatMap((group) =>
		[...group]
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(keepPerSource)
			.map((record) => record.path)
	);
}
```

Add `parseUpgradeBackupName(path)` using the exact filename regex from Step 5’s test and return `null` for non-upgrade files. The retention function above groups by `sourceSchema`, sorts newest first, and returns only records beyond the newest two; add a unit test with three v4 backups and two v3 backups that expects only the oldest v4 path.

- [x] **Step 6: Re-export the focused APIs and remove duplicate validation logic**

In `src/lib/backup/index.ts`, replace the body of `validateImport` with a compatibility wrapper during this task:

```ts
export async function validateImport(db: DatabaseService, expectedVersion: number) {
	const result = await validateDatabase(db, { exact: expectedVersion });
	return result.valid ? { valid: true } : { valid: false, error: validationMessage(result) };
}

export { validateDatabase } from './validation';
export { createVerifiedUpgradeBackup, getUpgradeBackupsToDelete } from './upgrade';
```

Keep existing callers green until Task 5 moves restore to the range policy.

- [x] **Step 7: Run backup and mutation tests**

Run: `pnpm vitest run src/tests/unit/backup.test.ts src/tests/unit/upgrade-backup.test.ts`

Expected: PASS, including opening the generated backup as a real SQLite database.

Add `src/lib/db/schema.ts`, `src/lib/backup/validation.ts`, and `src/lib/backup/upgrade.ts` to the explicit mutation targets in `stryker.db.conf.mjs`. Exclude `.codegraph/` from Stryker temporary-copy input without modifying `.codegraph/`. Defer `src/lib/db/startup.ts` and `src/lib/recovery.ts` as mutation targets, and run the complete database mutation gate after Task 5 when all target files exist.

Expected: the database mutation target completes without surviving mutants in the new policy branches.

- [x] **Step 8: Commit Task 2**

```sh
git add src/lib/backup src/tests/unit/backup.test.ts src/tests/unit/upgrade-backup.test.ts stryker.db.conf.mjs
git commit -m "feat(backup): verify pre-upgrade recovery points"
```

---

### Task 3: Protected startup coordinator

**Files:**
- Create: `src/lib/db/startup.ts`
- Create: `src/tests/unit/startup.test.ts`
- Modify: `src/lib/db/integrity.ts`

**Interfaces:**
- Consumes: `inspectSchema`, `createVerifiedUpgradeBackup`, `runMigrations`, `runIntegrityCheck`, and `checkOrphanedTransfers`.
- Produces: `prepareDatabase(db, dependencies, onStage): Promise<StartupSuccess>`.
- Produces: `DatabaseStartupError` carrying a non-sensitive `RecoveryContext`.

- [x] **Step 1: Write failing coordinator-order tests**

Use a real file-backed copy of `v004.sqlite` and dependency spies that append event names:

```ts
const events: string[] = [];
const result = await prepareDatabase(db, {
	latestSchemaVersion: 5,
	appVersion: '0.1.4',
	now: () => new Date('2026-08-15T11:00:00.000Z'),
	createUpgradeBackup: async () => { events.push('backup'); return verifiedRecord; },
	runMigrations: async () => { events.push('migrate'); await runMigrations(db, migrations); },
	verifyAfterMigration: async () => { events.push('verify'); await runIntegrityCheck(db); }
}, (stage) => events.push(stage));

expect(events).toEqual(['checking', 'backing_up', 'backup', 'migrating', 'migrate', 'verifying', 'verify', 'ready']);
expect(result).toMatchObject({ schemaVersion: 5, migratedFrom: 4, backup: verifiedRecord });
```

Add separate tests proving fresh/current databases skip upgrade backup, newer/invalid databases never call migration, backup failure never calls migration, and migration failure leaves source schema `4` readable.

- [x] **Step 2: Run the coordinator tests and confirm the red state**

Run: `pnpm vitest run src/tests/unit/startup.test.ts`

Expected: FAIL because `$lib/db/startup` does not exist.

- [x] **Step 3: Implement startup types and stable failure codes**

Create `src/lib/db/startup.ts` with this contract:

```ts
export type StartupStage = 'checking' | 'backing_up' | 'migrating' | 'verifying' | 'ready' | 'recovery_required';
export type StartupFailureCode =
	| 'database_corrupt'
	| 'database_schema_invalid'
	| 'database_schema_newer'
	| 'upgrade_backup_failed'
	| 'migration_failed'
	| 'post_migration_verification_failed';

export interface RecoveryContext {
	code: StartupFailureCode;
	appVersion: string;
	latestSchemaVersion: number;
	detectedSchemaVersion: number | null;
	liveDatabasePath: string;
	backupPath: string | null;
	detail: string;
}

export interface StartupSuccess {
	schemaVersion: number;
	migratedFrom: number | null;
	backup: UpgradeBackupRecord | null;
}

export class DatabaseStartupError extends Error {
	constructor(readonly recovery: RecoveryContext, options?: ErrorOptions) {
		super(recovery.code, options);
		this.name = 'DatabaseStartupError';
	}
}
```

Define `StartupDependencies` with exact fields used in the test: schema/app/path values, `now`, `createUpgradeBackup`, `runMigrations`, and `verifyAfterMigration`.

- [x] **Step 4: Implement the coordinator state machine**

The core branch must remain visibly ordered:

```ts
onStage('checking');
await runIntegrityCheck(db);
const inspection = await inspectSchema(db, dependencies.latestSchemaVersion);

if (inspection.kind === 'newer') throw startupError('database_schema_newer', inspection.version);
if (inspection.kind === 'invalid') throw startupError('database_schema_invalid', null, inspection.reason);

let backup: UpgradeBackupRecord | null = null;
let migratedFrom: number | null = null;
if (inspection.kind === 'older') {
	migratedFrom = inspection.version;
	onStage('backing_up');
	backup = await dependencies.createUpgradeBackup(inspection.version);
}

if (inspection.kind === 'fresh' || inspection.kind === 'older') {
	onStage('migrating');
	await dependencies.runMigrations();
}

onStage('verifying');
await dependencies.verifyAfterMigration();
await writeStartupMetadata(db, dependencies, migratedFrom, backup);
onStage('ready');
return { schemaVersion: dependencies.latestSchemaVersion, migratedFrom, backup };
```

Wrap each boundary separately so recovery codes distinguish integrity, backup, migration, and post-migration verification failures. Preserve only `String(error)` in `detail`; do not include SQL parameters or queried rows.

- [x] **Step 5: Add metadata assertions**

Test and implement these `app_meta` keys after success:

```text
last_successful_app_version
last_successful_schema_version
last_successful_startup_at
last_migrated_from_schema
last_upgrade_backup_path
```

Delete `last_migrated_from_schema` and `last_upgrade_backup_path` only for a fresh database. A current-schema launch must not erase the last upgrade record shown in Settings.

- [x] **Step 6: Run coordinator and integrity tests**

Run: `pnpm vitest run src/tests/unit/startup.test.ts src/tests/unit/migrations.test.ts src/tests/unit/integrity.test.ts`

Expected: PASS. The failed-migration test must reopen the same file and observe source schema `4` plus the original fixture transaction.

- [x] **Step 7: Commit Task 3**

```sh
git add src/lib/db/startup.ts src/lib/db/integrity.ts src/tests/unit/startup.test.ts
git commit -m "feat(db): protect database startup upgrades"
```

---

### Task 4: Tauri platform adapter and main-window-only initialization

**Files:**
- Create: `src/lib/db/platform.ts`
- Modify: `src/lib/db/index.ts`
- Modify: `src/lib/stores/db.svelte.ts`
- Modify: `src/routes/quick-add/+page.svelte`
- Create: `src/tests/unit/db-startup-integration.test.ts`

**Interfaces:**
- Consumes: `prepareDatabase` and schema constants.
- Produces: `initializeDb(onStage): Promise<StartupSuccess>` for the main window.
- Preserves: `getDb(): Promise<DatabaseService>` for finance repositories after successful initialization.
- Produces: `getDatabasePaths(): Promise<{ dataDir; databasePath; routineBackupDir; upgradeBackupDir }>`.

- [x] **Step 1: Write failing integration tests for initialization ownership**

Add tests that inject an opener and prove:

```ts
it('coalesces concurrent main-window initialization', async () => {
	const [first, second] = await Promise.all([initializeDb(onStage), initializeDb(onStage)]);
	expect(first).toEqual(second);
	expect(openConnection).toHaveBeenCalledTimes(1);
});

it('quick access rejects an older schema without migrating it', async () => {
	await expect(openCurrentDb()).rejects.toMatchObject({ code: 'database_update_required' });
	expect(readSchemaVersion(fixture)).resolves.toBe(4);
});
```

- [x] **Step 2: Run the integration test and confirm the red state**

Run: `pnpm vitest run src/tests/unit/db-startup-integration.test.ts`

Expected: FAIL because `initializeDb`, `openCurrentDb`, and `platform.ts` do not exist.

- [x] **Step 3: Implement the Tauri platform adapter**

Create `src/lib/db/platform.ts`:

```ts
export async function getDatabasePaths() {
	const { appDataDir, join } = await import('@tauri-apps/api/path');
	const dataDir = await appDataDir();
	return {
		dataDir,
		databasePath: await join(dataDir, 'notchy.db'),
		routineBackupDir: await join(dataDir, 'backups'),
		upgradeBackupDir: await join(dataDir, 'backups', 'upgrades')
	};
}

export async function getInstalledAppVersion(): Promise<string> {
	if (!isTauri()) return 'web-test';
	const { getVersion } = await import('@tauri-apps/api/app');
	return getVersion();
}
```

Add `ensureDirectory(path)` using `mkdir(path, { recursive: true })`, `openReadOnlyDatabase(path)` using `createTauriDb(`sqlite:${path}?readonly`)`, and `listUpgradeBackupRecords(path)` using `readDir` plus `parseUpgradeBackupName`.

- [x] **Step 4: Refactor database initialization without weakening `getDb`**

In `src/lib/db/index.ts`, keep one connection promise and one initialization promise:

```ts
let _db: DatabaseService | null = null;
let initialization: Promise<StartupSuccess> | null = null;

export function initializeDb(onStage: (stage: StartupStage) => void = () => {}): Promise<StartupSuccess> {
	if (initialization) return initialization;
	initialization = initializeMainDatabase(onStage).catch(async (error) => {
		await closeDb();
		initialization = null;
		throw error;
	});
	return initialization;
}

export async function getDb(): Promise<DatabaseService> {
	if (_db) return _db;
	if (!isTauri()) {
		await initializeDb();
		return _db!;
	}
	return openCurrentDb();
}
```

`initializeMainDatabase` constructs real dependencies, ensures `backups/upgrades/`, prunes only after a verified new backup exists, and passes `runIntegrityCheck` plus `checkOrphanedTransfers` as post-verification. `openCurrentDb` applies pragmas, calls `inspectSchema`, returns only for `current`, and otherwise closes the connection and throws `new AppError('database_update_required')`.

- [x] **Step 5: Make `DbStore` expose startup state and retry**

Replace boolean-only state with:

```ts
stage = $state<StartupStage>('checking');
ready = $derived(this.stage === 'ready');
firstRunComplete = $state(false);
recovery = $state<RecoveryContext | null>(null);

async init(): Promise<void> {
	this.recovery = null;
	try {
		await initializeDb((stage) => { this.stage = stage; });
		const db = await getDb();
		this.firstRunComplete = await meta.isFirstRunComplete(db);
		this.stage = 'ready';
		void runAutoBackup(db);
	} catch (error) {
		this.stage = 'recovery_required';
		this.recovery = error instanceof DatabaseStartupError ? error.recovery : fallbackRecovery(error);
	}
}

async retry(): Promise<void> {
	await closeDb();
	await this.init();
}
```

Preserve the existing guarded E2E test hooks after readiness.

- [x] **Step 6: Give quick-add an explicit update-required state**

In `src/routes/quick-add/+page.svelte`, catch `AppError('database_update_required')` and render `m.quick_add_database_update_required()` instead of the generic save error. Do not call `runMigrations` or `initializeDb` from that route.

- [x] **Step 7: Run integration, quick-add, and type checks**

Run: `pnpm vitest run src/tests/unit/db-startup-integration.test.ts src/tests/unit/quick_account.test.ts src/tests/unit/quick_parse.test.ts`

Expected: PASS.

Run: `pnpm check`

Expected: 0 errors; the existing documented autofocus warning may remain until separately addressed.

- [x] **Step 8: Commit Task 4**

```sh
git add src/lib/db/platform.ts src/lib/db/index.ts src/lib/stores/db.svelte.ts src/routes/quick-add/+page.svelte src/tests/unit/db-startup-integration.test.ts
git commit -m "feat(db): centralize main-window initialization"
```

---

### Task 5: Safe restore policy and sanitized recovery reports

**Files:**
- Create: `src/lib/recovery.ts`
- Create: `src/tests/unit/recovery.test.ts`
- Modify: `src/lib/backup/index.ts`
- Modify: `src/tests/unit/backup.test.ts`
- Modify: `src/tests/e2e/backup-restore.spec.ts`

**Interfaces:**
- Consumes: `MIN_SUPPORTED_SCHEMA_VERSION`, `LATEST_SCHEMA_VERSION`, `validateDatabase`, `closeDb`, and Tauri file copy.
- Produces: `restoreCompatibleDatabase(sourcePath): Promise<{ schemaVersion: number }>`.
- Produces: `buildTechnicalReport(context): string` with an allowlisted field set.

- [x] **Step 1: Write failing restore compatibility tests**

Use copied migration fixtures and a fake replacement callback:

```ts
it('accepts a released older backup and returns its version for forward migration', async () => {
	const result = await validateDatabase(v004Db, { min: MIN_SUPPORTED_SCHEMA_VERSION, max: LATEST_SCHEMA_VERSION });
	expect(result).toEqual({ valid: true, schemaVersion: 4 });
});

it('rejects a newer backup before replacing the live file', async () => {
	await newerDb.execute("UPDATE app_meta SET value = '6' WHERE key = 'schema_version'");
	await expect(restoreCompatibleDatabase(newerPath, dependencies)).rejects.toMatchObject({ code: 'backup_schema_newer' });
	expect(dependencies.replaceLiveDatabase).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Write the report-redaction test**

```ts
const report = buildTechnicalReport({
	code: 'migration_failed', appVersion: '0.1.4', latestSchemaVersion: 5,
	detectedSchemaVersion: 4, liveDatabasePath: '/data/notchy.db', backupPath: '/data/backups/safe.sqlite',
	detail: 'SQLITE_ERROR while migrating 005; payee=Private Clinic; amount=900000'
});
expect(report).toContain('migration_failed');
expect(report).toContain('0.1.4');
expect(report).not.toContain('Private Clinic');
expect(report).not.toContain('900000');
```

The implementation must omit `detail` entirely from the copyable report. It may remain in process logs only after SQL parameters have been excluded at the throw site.

- [x] **Step 3: Run recovery tests and confirm the red state**

Run: `pnpm vitest run src/tests/unit/recovery.test.ts src/tests/unit/backup.test.ts`

Expected: FAIL because `$lib/recovery` does not exist and restore still requires exact schema `5`.

- [x] **Step 4: Implement compatible restore as validate-close-replace**

Create `src/lib/recovery.ts` with dependency injection for unit tests and a Tauri wrapper:

```ts
export interface RestoreDependencies {
	openReadOnly(path: string): Promise<DatabaseService>;
	replaceLiveDatabase(sourcePath: string): Promise<void>;
}

export async function restoreCompatibleDatabase(
	sourcePath: string,
	dependencies: RestoreDependencies = tauriRestoreDependencies
): Promise<{ schemaVersion: number }> {
	const candidate = await dependencies.openReadOnly(sourcePath);
	let validation: DatabaseValidation;
	try {
		validation = await validateDatabase(candidate, { min: MIN_SUPPORTED_SCHEMA_VERSION, max: LATEST_SCHEMA_VERSION });
	} finally {
		await candidate.close();
	}
	if (!validation.valid) throw restoreError(validation);
	await dependencies.replaceLiveDatabase(sourcePath);
	return { schemaVersion: validation.schemaVersion };
}
```

The Tauri replacement dependency closes the live connection before `copyFile`, then leaves reopening and forward migration to the page reload. Never copy while the candidate connection is still open.

- [x] **Step 5: Implement allowlisted technical reports**

```ts
export function buildTechnicalReport(context: RecoveryContext): string {
	return JSON.stringify({
		code: context.code,
		appVersion: context.appVersion,
		latestSchemaVersion: context.latestSchemaVersion,
		detectedSchemaVersion: context.detectedSchemaVersion,
		liveDatabasePath: context.liveDatabasePath,
		backupPath: context.backupPath
	}, null, 2);
}
```

Do not serialize `context.detail` and do not accept arbitrary extra keys.

- [x] **Step 6: Replace numeric `importDatabase(path, 5)` callers**

Remove `importDatabase` after updating Settings, E2E hooks, and all tests in the same commit to call `restoreCompatibleDatabase(path)` without a hardcoded schema literal. Verify removal with `rg -n "importDatabase|validateImport" src` and expect no matches.

- [x] **Step 7: Run unit and backup E2E tests**

Run: `pnpm vitest run src/tests/unit/recovery.test.ts src/tests/unit/backup.test.ts`

Expected: PASS.

Run: `pnpm playwright test src/tests/e2e/backup-restore.spec.ts`

Expected: PASS, including supported-v4 restore followed by migration and schema-v6 rejection with the live dataset unchanged.

Run: `pnpm test:mutation:db`

Expected: the complete database mutation target, now including `startup.ts` and `recovery.ts`, completes without surviving mutants in the new policy branches.

- [x] **Step 8: Commit Task 5**

```sh
git add src/lib/recovery.ts src/lib/backup/index.ts src/tests/unit/recovery.test.ts src/tests/unit/backup.test.ts src/tests/e2e/backup-restore.spec.ts
git commit -m "feat(backup): restore compatible older databases"
```

---

### Task 6: Blocking recovery UI and localized startup states

**Files:**
- Create: `src/lib/components/system/RecoveryScreen.svelte`
- Create: `src/tests/unit/components/RecoveryScreen.test.ts`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/lib/stores/db.svelte.ts`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Consumes: `dbStore.stage`, `dbStore.recovery`, `dbStore.retry`, `restoreCompatibleDatabase`, and `buildTechnicalReport`.
- Produces: recovery UI callbacks `onretry`, `onrestore`, `onopenfolder`, and `onquit`.

- [x] **Step 1: Write failing component tests**

Render the component with a fixed `RecoveryContext` and callback spies:

```ts
it('shows non-sensitive recovery facts and exposes all actions', async () => {
	const onretry = vi.fn();
	const { getByRole, queryByText } = render(RecoveryScreen, { props: { context, onretry, onrestore, onopenfolder, onquit } });
	expect(getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
	expect(queryByText('Private Clinic')).toBeNull();
	await fireEvent.click(getByRole('button', { name: 'Retry' }));
	expect(onretry).toHaveBeenCalledOnce();
});
```

Assert restore is absent when `backupPath` is null and present when it is non-null. Assert technical-report copy uses `navigator.clipboard.writeText` with the allowlisted report.

- [x] **Step 2: Run the component test and confirm the red state**

Run: `pnpm vitest run src/tests/unit/components/RecoveryScreen.test.ts`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Add exact English and Vietnamese message keys**

Add matching keys including:

```json
"startup_checking": "Checking your data…",
"startup_backing_up": "Creating a recovery backup…",
"startup_migrating": "Upgrading your data…",
"startup_verifying": "Verifying your data…",
"recovery_title": "Notchy needs attention",
"recovery_retry": "Retry",
"recovery_restore": "Restore verified backup",
"recovery_open_folder": "Open backup folder",
"recovery_copy_report": "Copy technical report",
"recovery_quit": "Quit Notchy"
```

Provide natural Vietnamese translations in `messages/vi.json`, including “Notchy cần bạn kiểm tra” for `recovery_title`. Add separate localized descriptions for every `StartupFailureCode`; do not interpolate raw `detail` into user-visible copy.

- [x] **Step 4: Implement the recovery component**

Use an accessible main status region and explicit button labels:

```svelte
<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { buildTechnicalReport } from '$lib/recovery';
	import type { RecoveryContext } from '$lib/db/startup';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		context: RecoveryContext;
		onretry: () => void | Promise<void>;
		onrestore: () => void | Promise<void>;
		onopenfolder: () => void | Promise<void>;
		onquit: () => void | Promise<void>;
	}

	let { context, onretry, onrestore, onopenfolder, onquit } = $props<Props>();
	let confirmRestore = $state(false);
	async function copyReport() { await navigator.clipboard.writeText(buildTechnicalReport(context)); }
</script>
```

Render app/schema versions and file paths, never `detail`. Gate restore on `context.backupPath`, and wrap restore in `ConfirmDialog`.

- [x] **Step 5: Wire startup and recovery branches into the root layout**

Replace the single `!dbStore.ready` warming screen branch with:

```svelte
{:else if dbStore.stage === 'recovery_required' && dbStore.recovery}
	<RecoveryScreen
		context={dbStore.recovery}
		onretry={() => dbStore.retry()}
		onrestore={() => dbStore.restoreLatestBackup()}
		onopenfolder={() => dbStore.openBackupFolder()}
		onquit={() => dbStore.quit()}
	/>
{:else if !dbStore.ready}
	<StartupProgress stage={dbStore.stage} />
```

The onboarding redirect stays after `ready`; a startup failure must never navigate to `/onboarding`.

- [x] **Step 6: Implement store recovery actions**

Add methods that call focused services:

```ts
async restoreLatestBackup(): Promise<void> {
	if (!this.recovery?.backupPath) return;
	await restoreCompatibleDatabase(this.recovery.backupPath);
	globalThis.location.reload();
}

async openBackupFolder(): Promise<void> {
	const { upgradeBackupDir } = await getDatabasePaths();
	await openBackupFolder(upgradeBackupDir);
}

async quit(): Promise<void> {
	if (isTauri()) await invoke('quit_app');
}
```

`openBackupFolder` and the Rust command are wired in Task 7; unit tests mock them now.

- [x] **Step 7: Run component, i18n, and type checks**

Run: `pnpm vitest run src/tests/unit/components/RecoveryScreen.test.ts src/tests/unit/i18n.test.ts`

Expected: PASS and EN/VI key parity remains exact.

Run: `pnpm check`

Expected: 0 errors.

- [x] **Step 8: Commit Task 6**

```sh
git add src/lib/components/system/RecoveryScreen.svelte src/routes/+layout.svelte src/lib/stores/db.svelte.ts src/tests/unit/components/RecoveryScreen.test.ts messages/en.json messages/vi.json
git commit -m "feat(ui): add database recovery startup screen"
```

---

### Task 7: Backup health in Settings and Ubuntu file-manager integration

**Files:**
- Modify: `src/routes/settings/backup/+page.svelte`
- Create: `src/lib/backup/health.ts`
- Create: `src/tests/unit/backup-health.test.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

**Interfaces:**
- Produces: `getBackupHealth(db): Promise<BackupHealth>`.
- Produces: `createManualBackup(db): Promise<string>`.
- Produces: `openBackupFolder(path): Promise<void>` through official Tauri opener.

- [x] **Step 1: Write failing backup-health tests**

```ts
expect(await getBackupHealth(db, {
	appVersion: '0.1.4', databasePath: '/data/notchy.db', upgradeBackupDir: '/data/backups/upgrades'
})).toEqual({
	appVersion: '0.1.4', schemaVersion: 5, databasePath: '/data/notchy.db',
	lastRoutineBackupAt: null, lastUpgradeBackupPath: null, lastUpgradeFromSchema: null, warning: null
});
```

Seed each metadata key and assert it appears without reading financial tables.

- [x] **Step 2: Run the health test and confirm the red state**

Run: `pnpm vitest run src/tests/unit/backup-health.test.ts`

Expected: FAIL because `$lib/backup/health` does not exist.

- [x] **Step 3: Implement the backup-health query and manual backup**

Create `src/lib/backup/health.ts` with:

```ts
export interface BackupHealth {
	appVersion: string;
	schemaVersion: number;
	databasePath: string;
	lastRoutineBackupAt: string | null;
	lastUpgradeBackupPath: string | null;
	lastUpgradeFromSchema: number | null;
	warning: string | null;
}
```

Read only `schema_version`, `last_backup_at`, `last_upgrade_backup_path`, `last_migrated_from_schema`, and `backup_warning` from `app_meta`. `createManualBackup` ensures the routine backup directory, calls `createBackup`, and updates `last_backup_at` only after success.

- [x] **Step 4: Install and initialize the official opener plugin**

Run: `pnpm add @tauri-apps/plugin-opener@2.5.0`

Add to `src-tauri/Cargo.toml`:

```toml
tauri-plugin-opener = "2.5.0"
```

Initialize it in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn quit_app(app: tauri::AppHandle) { app.exit(0); }

tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![quit_app])
    .plugin(tauri_plugin_opener::init())
```

Preserve every existing plugin and tray handler. Add the path-scoped permission `"opener:allow-open-path"` to `src-tauri/capabilities/default.json`. Do not add URL-opening or command-execution permissions.

- [x] **Step 5: Implement the Settings actions and health card**

Use `openPath` from `@tauri-apps/plugin-opener`:

```ts
export async function openBackupFolder(path: string): Promise<void> {
	const { openPath } = await import('@tauri-apps/plugin-opener');
	await openPath(path);
}
```

On mount, load `BackupHealth`. Render labeled app version, schema version, database path, last routine backup, and last pre-upgrade backup. Add “Create backup now” and “Open backup folder” buttons; refresh health after manual backup. Keep current SQLite export, CSV export, and destructive restore controls.

- [x] **Step 6: Add EN/VI Settings copy and test parity**

Add exact keys for version, schema, database path, last backup, no backup, create now, created toast, open folder, and backup warning. Run:

`pnpm vitest run src/tests/unit/backup-health.test.ts src/tests/unit/i18n.test.ts`

Expected: PASS.

- [x] **Step 7: Run Rust and Svelte checks**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: exit 0 with opener plugin and `quit_app` registered.

Run: `pnpm check`

Expected: 0 errors.

- [x] **Step 8: Commit Task 7**

```sh
git add package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json src/lib/backup/health.ts src/routes/settings/backup/+page.svelte src/tests/unit/backup-health.test.ts messages/en.json messages/vi.json
git commit -m "feat(settings): expose database backup health"
```

---

### Task 8: Recovery E2E coverage

**Files:**
- Create: `src/tests/e2e/startup-recovery.spec.ts`
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts`
- Modify: `src/tests/e2e/backup-restore.spec.ts`

**Interfaces:**
- Consumes: root recovery UI, startup coordinator, restore policy, and existing Tauri mock.
- Produces: configurable mock options `initialSchemaVersion`, `failUpgradeBackup`, and `failMigrationVersion`.

- [x] **Step 1: Extend the Tauri mock contract in a failing test**

Add options:

```ts
export interface TauriMockOptions {
	seedMeta?: Record<string, string>;
	persist?: boolean;
	initialSchemaVersion?: number;
	failUpgradeBackup?: boolean;
	failMigrationVersion?: number;
}
```

Write E2E cases that request these options before implementing mock behavior.

- [x] **Step 2: Add the recovery journeys**

Create `src/tests/e2e/startup-recovery.spec.ts`:

```ts
test.describe('protected startup', () => {
	test('blocks finance routes when the database schema is newer', async ({ tauriMockPage: page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
		await expect(page.getByText(/schema 6/i)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
	});

	test('shows a verified backup after a migration failure', async ({ tauriMockPage: page }) => {
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'Restore verified backup' })).toBeVisible();
		await expect(page.getByText(/notchy-pre-upgrade-v4-to-v5/)).toBeVisible();
	});
});
```

Use per-test `test.use` values so the first case starts at schema `6`, and the second at schema `4` with migration `5` forced to fail.

- [x] **Step 3: Run E2E and confirm the red state**

Run: `pnpm playwright test src/tests/e2e/startup-recovery.spec.ts`

Expected: FAIL because mock options are not yet honored.

- [x] **Step 4: Implement mock failure controls without production hooks**

Seed the requested schema before application startup. Intercept only the Tauri mock’s `VACUUM INTO` and migration SQL paths; do not add production `window` flags. Record virtual upgrade backup files so restore/open-folder actions can be asserted.

- [x] **Step 5: Add retry and restore assertions**

Verify retry does not reach finance UI while the injected fault remains. For restore, clear the injected migration failure through a mock-only Playwright callback, click restore, wait for reload, and assert the original fixture transaction and schema `5` survive.

- [x] **Step 6: Run focused and full E2E**

Run: `pnpm playwright test src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/backup-restore.spec.ts src/tests/e2e/quick-add.spec.ts`

Expected: PASS.

Run: `pnpm test:e2e`

Expected: all Playwright tests PASS with no reduction from the existing 87-test floor.

- [x] **Step 7: Commit Task 8**

```sh
git add src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/backup-restore.spec.ts
git commit -m "test(e2e): cover protected startup recovery"
```

---

### Task 9: Reproducible `.deb` dogfood release tooling

**Files:**
- Create: `scripts/release-dogfood.mjs`
- Create: `scripts/release-dogfood.test.mjs`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Create: `specs/notes/2026-08-15-v0.1.4.md`

**Interfaces:**
- Produces: `pnpm release:dogfood`.
- Produces: `notchy_0.1.4_amd64.deb` and `notchy_0.1.4_amd64.deb.sha256` under `artifacts/0.1.4/`.
- Produces: pure exported helpers `readDeclaredVersions`, `assertVersionsMatch`, `artifactNames`, and `sha256File`.

- [x] **Step 1: Write failing Node tests for release helpers**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertVersionsMatch, artifactNames } from './release-dogfood.mjs';

test('requires package, Tauri, and Cargo versions to match', () => {
	assert.throws(() => assertVersionsMatch({ package: '0.1.4', tauri: '0.1.4', cargo: '0.1.3' }), /version mismatch/);
});

test('uses deterministic Debian artifact names', () => {
	assert.deepEqual(artifactNames('0.1.4', 'amd64'), {
		deb: 'notchy_0.1.4_amd64.deb', checksum: 'notchy_0.1.4_amd64.deb.sha256'
	});
});
```

- [x] **Step 2: Run the release-tooling test and confirm the red state**

Run: `node --test scripts/release-dogfood.test.mjs`

Expected: FAIL because `release-dogfood.mjs` does not exist.

- [x] **Step 3: Implement pure version and artifact helpers**

Parse JSON with `JSON.parse`, and extract Cargo’s first package-version assignment with:

```js
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
```

`assertVersionsMatch` compares all three values and throws an error listing each declaration. `artifactNames` returns the names asserted above. `sha256File` uses `createHash('sha256')` and `readFile`; it writes `<hash>  <deb filename>\n`.

- [x] **Step 4: Implement the guarded release command**

The main function runs commands with `spawnSync(command, args, { stdio: 'inherit' })` and stops on the first nonzero status. Use this exact order:

```js
run('git', ['diff', '--quiet']);
run('git', ['diff', '--cached', '--quiet']);
run('pnpm', ['test']);
run('pnpm', ['check']);
run('pnpm', ['tauri', 'build', '--bundles', 'deb']);
```

After the build, locate exactly one `.deb` under `src-tauri/target/release/bundle/deb/`, create `artifacts/0.1.4/`, copy it to the deterministic lowercase name, write the checksum, and print both absolute paths. Refuse ambiguous zero/multiple artifact matches.

- [x] **Step 5: Synchronize version `0.1.4` and package scripts**

Set `0.1.4` in:

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
```

Add:

```json
"test:release-tooling": "node --test scripts/release-dogfood.test.mjs",
"release:dogfood": "node scripts/release-dogfood.mjs"
```

Update `pnpm-lock.yaml` through `pnpm install --lockfile-only` if package metadata requires it.

- [x] **Step 6: Write concrete 0.1.4 release notes**

Create `specs/notes/2026-08-15-v0.1.4.md` with:

- Ubuntu install command `sudo apt install ./notchy_0.1.4_amd64.deb`.
- Current schema `5`, released source schemas `3` and `4`.
- Pre-upgrade backup location `backups/upgrades/` below the app-data directory.
- User-visible recovery and Settings changes.
- Explicit statement that automatic updates and downgrades are unsupported.
- Verification commands and a blank manual packaged-build result table for Ubuntu version, source app/schema, target app/schema, result, and evidence path.

- [x] **Step 7: Run release-tooling tests and version check**

Run: `pnpm test:release-tooling`

Expected: PASS.

Run: `node -e "const p=require('./package.json'); const t=require('./src-tauri/tauri.conf.json'); if(p.version!==t.version||p.version!=='0.1.4') process.exit(1)"`

Expected: exit 0.

- [x] **Step 8: Commit Task 9**

```sh
git add scripts/release-dogfood.mjs scripts/release-dogfood.test.mjs package.json pnpm-lock.yaml src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock specs/notes/2026-08-15-v0.1.4.md
git commit -m "chore(release): add Ubuntu dogfood build lane"
```

---

### Task 10: Final verification and packaged Ubuntu upgrade

**Files:**
- Modify: `specs/2026-07-27-desktop-release-smoke-checklist.md`
- Modify: `specs/notes/2026-08-15-v0.1.4.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: a tested `.deb`, checksum, and recorded upgrade evidence; no new runtime API.

- [x] **Step 1: Run the complete automated verification suite**

Run in order:

```sh
pnpm test
pnpm check
pnpm test:e2e
pnpm test:mutation
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0. Record exact unit/E2E counts and any accepted non-error warning in the release notes.

- [x] **Step 2: Review financial-data failure invariants**

Temporarily break each of these lines one at a time and prove the named test fails, then restore the implementation:

1. Skip `createUpgradeBackup` before migration → coordinator-order test fails.
2. Accept `schemaVersion > LATEST_SCHEMA_VERSION` → newer-schema test fails.
3. Serialize `context.detail` → redaction test fails.
4. Call replacement before candidate validation → restore no-modification test fails.

Run the focused test after restoring each mutation. Do not commit deliberate breakage.

- [x] **Step 3: Build the clean release artifact**

Ensure all implementation commits exist and the tracked worktree is clean, then run:

`pnpm release:dogfood`

Expected output includes absolute paths to:

```text
artifacts/0.1.4/notchy_0.1.4_amd64.deb
artifacts/0.1.4/notchy_0.1.4_amd64.deb.sha256
```

Verify: `sha256sum -c artifacts/0.1.4/notchy_0.1.4_amd64.deb.sha256`

Expected: `notchy_0.1.4_amd64.deb: OK`.

- [x] **Step 4: Run the packaged Ubuntu upgrade checkpoint**

This step changes the workstation package installation and requires explicit user approval at execution time.

1. Install the prior Notchy `0.1.3` `.deb`.
2. Enter non-sensitive sample data: checking account, expense, income, transfer, budget allocation, locale, and quick-add account.
3. Quit and relaunch; confirm all data persists.
4. Install with `sudo apt install ./artifacts/0.1.4/notchy_0.1.4_amd64.deb`.
5. Launch 0.1.4 and record detected source schema and target schema `5`. Because this `0.1.3` to `0.1.4` checkpoint keeps schema `5`, record that no pre-upgrade backup is expected; the automated released-fixture `v4` to `v5` coverage is the evidence for mandatory backup-before-migration behavior.
6. Confirm the original account, transactions, transfer direction, balances, budget, locale, tray, and `Ctrl+Shift+N` quick-add.
7. Create a manual backup, add a transaction, restore the manual backup, and confirm the added transaction disappears while earlier data remains.

Expected: every case passes; any failure blocks recommending the build for real data.

- [x] **Step 5: Record evidence in the checklist and release notes**

Add columns to the upgrade row in `specs/2026-07-27-desktop-release-smoke-checklist.md` for source app/schema, target app/schema, and pre-upgrade backup path. Fill the 0.1.3 → 0.1.4 Ubuntu result in both documents with the actual OS version, result, and non-sensitive evidence paths.

- [x] **Step 6: Run final documentation and worktree checks**

Run:

```sh
git diff --check
rg -n -i "T[B]D|T[O]DO|implement la[t]er|fill i[n]" specs/notes/2026-08-15-v0.1.4.md specs/2026-07-27-desktop-release-smoke-checklist.md
git status --short
```

Expected: no whitespace errors, no placeholders in completed release records, and only the intended documentation changes remain.

- [x] **Step 7: Commit verification evidence**

```sh
git add specs/2026-07-27-desktop-release-smoke-checklist.md specs/notes/2026-08-15-v0.1.4.md
git commit -m "docs: verify Ubuntu 0.1.4 upgrade path"
```

---

## Completion Gate

Do not call the feature complete merely because unit and browser tests pass. Completion requires all of the following:

- The protected startup suite passes against released schema fixtures `3` and `4`.
- A schema-changing startup cannot reach migration without a verified backup.
- Newer and invalid schemas reach recovery without mutation.
- Recovery reports contain no financial fields or raw failure detail.
- Settings exposes the database and backup health needed for self-service recovery.
- `notchy_0.1.4_amd64.deb` and its checksum are reproducible through one command.
- The 0.1.3 → 0.1.4 no-migration upgrade is executed on Ubuntu with persistence, tray, quick-add, backup, and restore results recorded; the released-fixture migration suite proves pre-upgrade backup behavior for schema-changing upgrades.
