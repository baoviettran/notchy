# Settings → Backup on the native port

**Serves:** STORY-023

**Status:** Design — awaiting plan
**Date:** 2026-09-29
**Trigger:** v0.2.0 Ubuntu release verification — `specs/notes/2026-08-17-v0.2.0.md`, Blocker 1.
**Predecessor:** `specs/2026-08-17-rust-database-integrity-boundary-design.md` — the cutover that removed raw SQL from the frontend and left this page behind.

## 1. The defect

On the desktop build, Settings → Backup & Data does not work at all. `+page.svelte:16` reaches the
database through a raw escape hatch:

```ts
/** Access the raw DatabaseService for legacy backup operations. */
function getRawDb(db: AppDatabase): DatabaseService {
	return (db as unknown as { raw: DatabaseService }).raw;
}
```

`raw` exists only on the browser client (`src/lib/db/browser/client.ts:421`). The native client
implements `AppDatabase` without one — deliberately, per its own contract
(`src/lib/db/client.ts:4`: *"Exposes domain services only: no `execute`, no `transaction`, no raw
SQL"*). Under Tauri `getRawDb()` returns `undefined`, so every call site throws:

| Call site | Line | What it needs | Why the port can't express it |
| --- | --- | --- | --- |
| `loadHealth` | 37 | 5 `app_meta` keys | — (already expressible; see §2.2) |
| `createBackupNow` | 56 | `VACUUM INTO '<dir>/<file>'` | raw SQL |
| `exportSqlite` | 83 | `VACUUM INTO '<chosen path>'` | raw SQL |
| `exportCsvFiles` | 98 | `SELECT * FROM ${table}` × 7 | generic SQL |

Observed on the `0.2.0` package: the health card renders only its two buttons and *"Something went
wrong. Please try again"* — no version, schema, path, or backup rows — and "Create backup now"
writes nothing. Evidence: `artifacts/0.2.0/evidence/backup-page-error.png`.

Nothing caught it because the E2E suite (`src/tests/e2e/backup-restore.spec.ts`) drives the web
build on the browser client, where `raw` does exist. The suite stayed green while the shipped
desktop page was dead.

**A second defect folds in.** Routine backups are named `notchy-backup-<ISO>.sqlite` by the JS
path, but `parse_backup_name` (`src-tauri/src/database/backup.rs:321`) accepts only
`notchy-backup-v{schema}-{app}-{ULID}.sqlite`, and `discover_verified_backups` (`:366`) skips every
name it cannot parse. So a routine backup is invisible to the recovery screen (STORY-030) — the one
place a user needs it most. Fixing the page without fixing this would produce a backup button whose
output the recovery screen cannot see.

## 2. What "ported" means

After this change no production page reads a raw SQL handle, and every backup write goes through one
crash-safe publisher. The port grows one member; the publisher grows no second implementation.

### 2.1 `BackupOps` — a new domain port

`src/lib/db/client.ts`, alongside the other ops interfaces:

```ts
export interface BackupOps {
	/** Publish a verified routine backup; resolve to its canonical path.
	 *  Records `last_backup_at` only if publication succeeded. */
	create(): Promise<string>;
	/** Write a validated copy of the live database to exactly `targetPath`,
	 *  replacing any existing file. */
	exportSqlite(targetPath: string): Promise<void>;
	/** Write one CSV per exported table into `dir`, replacing existing files.
	 *  Resolve to the written paths. */
	exportCsv(dir: string): Promise<string[]>;
}
```

`create()` takes no directory. The routine backup directory is the adapter's own
(`${dataDir}/backups`, agreed on both sides: `executor.rs:243` and `computeDatabasePaths`). The old
JS `backupDir` parameter existed so tests could redirect a backup; a port that lets any caller point
a "routine" backup anywhere is the same escape hatch in a new shape.

### 2.2 Health leaves the raw path — not the port

`getBackupHealth` takes a `DatabaseService` only to read five `app_meta` keys, and `db.meta.get()`
is already on the port for both adapters. The signature becomes
`getBackupHealth(meta: MetaOps, options: BackupHealthOptions)`.

Keys read, unchanged — never financial tables: `schema_version`, `last_backup_at`,
`last_upgrade_backup_path`, `last_migrated_from_schema`, `backup_warning`. No IPC, no Rust.

`createManualBackup` (`src/lib/backup/health.ts`) is retired: its three steps — resolve the routine
directory, ensure it exists, `VACUUM INTO` it, then record `last_backup_at` — are exactly
`BackupOps.create()`, and leaving a second orchestrator beside the port is how the raw handle
survives. Its `backupDir`/`ensureDirectory` seams move into the browser adapter, which is the only
caller that ever needed them.

The page keeps `getDatabasePaths()` for the paths it *displays* and for the "Open backup folder"
action; those are path-plugin calls, not raw SQL, and already work under Tauri.

## 3. Browser adapter

`src/lib/db/browser/backup.ts` — `BrowserBackupOps`, wrapping `createBackup` and `exportCsv` from
`$lib/backup` unchanged: same `VACUUM INTO`, same timestamp filename, same escaping, same
`backupDir`/`ensureDirectory` seams wired by `initBrowserDb`.

Timestamp filenames stay on this side on purpose: discovery is Rust-only (`discoverRestorePoints`
returns `[]` in browser), so a browser backup's name has no cross-adapter contract to honor. Zero
behavioural change here means the E2E suite remains a working control — it is the baseline this
change must not disturb, not the thing under repair.

## 4. Native adapter

`src/lib/db/native/backup.ts` — three `invoke()` bridges in the style of `native/recovery.ts`
(`isTauri()` guard, typed return, native-unavailable error in browser).

### 4.1 `backup_create`

Rust: `publish_backup(&paths.db_path, manager.backup_dir(), BackupFailurePoint::None)` — the
existing protocol (`backup.rs:143`): online copy to a unique temp, validate the source manifest
(integrity + foreign keys), `fsync` the file, atomic rename, `fsync` the directory. Then write
`last_backup_at` into `app_meta` and return the canonical path.

No new SQL surface, no new file protocol, no new naming rule: routine backups get
`final_backup_name` (`backup.rs:298`), the same shape upgrade backups already use — which is also
what makes them discoverable (§4.4).

`last_backup_at` is written **after** publication succeeds, preserving the invariant the JS path
documents today: a failed backup leaves the last known-good timestamp intact.

### 4.2 `backup_export_sqlite(target_path)`

New `export_backup_to(source_path, target_path)` in `backup.rs`: validate the source manifest →
`copy_online` to a temp file beside the target → validate the copy → `sync_file` → atomic rename
onto `target_path` → `fsync` the directory. Reuses the publication primitives rather than teaching
Rust a second way to write a database file.

Two properties, both wanted: an export can never produce a corrupt file, and a temp beside the
target keeps the rename on one filesystem. Replacing an existing target is expected — the save
dialog has already asked. A failure leaves no temp and does not touch the existing target.

### 4.3 `backup_export_csv(dir)`

New command over the same seven tables the JS export uses — `accounts`, `category_types`,
`category_tags`, `transactions`, `budgets`, `goals`, `reconciliations`, each
`WHERE deleted_at IS NULL` — one file per table, `sanitize_csv_cell` (`domains/export.rs:19`) per
cell so the spreadsheet-formula guard applies on the native path too. Resolves to written paths.

This is **not** `export_transactions_csv` (`domains/export.rs:58`): that is the flat,
date-filtered transactions report. Distinct feature; do not merge them.

The seven-table dump is duplicated JS ↔ Rust, as every other domain read already is. Accepted.

### 4.4 Legacy filename acceptance in discovery

`parse_backup_name` must additionally accept `notchy-backup-<ISO timestamp>.sqlite`, because those
files already exist on user disks and are the only backups a pre-fix desktop user has made. A
routine backup that the recovery screen cannot see is not a recovery point.

A legacy name carries no schema, app version, or ULID, so `scan_verified_backups` fills them from
the file itself:

- `schema_version` and `app_version` from `app_meta` — the same keys `read_source_meta` reads — then
  `manifest_for(schema)`; an unknown schema is excluded exactly as today.
- `id` from the filename timestamp via `Ulid::from_datetime`, so ordering against ULID-named
  records stays chronological (ULIDs sort by time) and `format_ulid_timestamp` round-trips.
- A malformed or non-ISO timestamp is not a candidate. The legacy name supplies a hint, never a
  verdict — every candidate is still revalidated through a read-only connection.

## 5. Failure behaviour

- **No new error codes are expected.** The commands reuse the existing tagged codes
  (`BackupUnavailable`, `DatabaseInvalid`, …), which the page already renders through `mapError`
  with en/vi copy. If a new code does prove necessary, Gate 2 makes it a compile error until
  `RUST_ERROR_MESSAGES` covers it.
- A failed `create()` publishes nothing visible and leaves `last_backup_at` alone.
- A failed `exportSqlite` leaves no temp behind and preserves an existing target.
- A legacy backup that fails validation stays excluded from discovery — a corrupt file with a
  plausible name must never displace a verified recovery point. Existing rule, unchanged.

## 6. Verification

Red first, then minimum to green (CLAUDE.md TDD discipline).

**Rust.** `parse_backup_name` accepts the legacy ISO form and rejects near-misses (no suffix, bad
timestamp, traversal). Legacy discovery reads schema/app from the file, validates it, orders it
correctly against ULID-named records, and excludes it when its schema is unknown or its bytes are
corrupt. `export_backup_to` writes a valid copy, refuses a corrupt source, leaves no temp on
failure, atomically replaces an existing target, and preserves that target when it fails. CSV
export writes seven files with correct headers, neutralizes a `=cmd` cell, and omits soft-deleted
rows.

**JS.** The `BackupOps` contract runs against the browser adapter with `createTestDb()` — real
SQLite in-memory, no mocks, per `src/tests/CLAUDE.md`. `getBackupHealth` runs against `db.meta`. A
page test asserts health renders and the three actions route through `db.backup`. A source-level
test asserts no file under `src/routes/` reads a raw database handle — the class, not the instance.
The rule matches the handle shape, not the substring: `as unknown as { raw:` and `getRawDb`, so a
legitimate `row.raw` (CSV row data, as in `ImportTransactionsModal.svelte:119`) is not a hit.

**Gates.** Gate 1 (`src/tests/unit/native-boundary.test.ts` + `helpers/rust-command-surface.ts`):
three new commands in the op table with fixtures, in the same commit — the sweep fails otherwise,
which is the guard working. Then `pnpm generate:db-contracts` with `pnpm check:db-contracts`,
`pnpm check`, `pnpm test`, `pnpm test:e2e`.

**Real proof.** Unchanged from Step 7: re-run the two GUI cases on the next package — "Create
backup now" writes a file, and the backup/restore round-trip completes. A skipped or failed GUI
case again leaves Step 7 `partial`. Playwright cannot substitute for it: it runs the browser
client, which is precisely why this defect shipped.

**Closing the trigger.** This is the last named blocker on Task 15 of
`specs/plans/2026-08-17-rust-database-integrity-boundary.md` (Steps 6–8 stay open). When the GUI
cases pass on a real package, that plan's remaining steps close with it — Step 6 by the `sudo apt
install` approval it gates, Step 7 by the passing run, Step 8 by recording the evidence. Flipping
those checkboxes is part of the work, not a follow-up: the roadmap counts a task done only when the
box is `[x]` and the commit is in history.

## 7. Out of scope

- **Auto-backup on launch.** The page's copy promises *"Backups are created automatically on every
  launch"*; `runAutoBackup` has no caller anywhere, so the promise is false on both adapters.
  Delivering it means a Rust startup path with a throttle — its own spec.
- **`retention_deletions` (`backup.rs:428`) stays unwired.** Once routine backups actually run,
  they accumulate with no bound. Second half of the same follow-up.
- **Removing the browser client's `raw` getter.** Two E2E specs use it deliberately
  (`csv-import.spec.ts:75,98`). `scripts/check-native-db-cutover.mjs` is the natural home for a
  `.raw` ban if we later want one.
- The restart/orphaned-temp case from Step 7 — `1ecb590` already covers it.

## 8. Accepted risks

- **Legacy-name acceptance widens what discovery will try to open.** Mitigated by the existing
  revalidation rule and by treating the name as a hint only; the worst case is a candidate that is
  skipped, which is today's behaviour for all of them.
- **The seven-table dump now exists twice.** Mitigated by tests pinning the table set and the
  soft-delete rule on both sides.
- **A ULID derived from a legacy filename is not a real ULID.** It is used for ordering and display
  only, never as a durable record id — `BackupSummary.id` for a legacy file is derived, and nothing
  persists it.

## 9. Files

| File | Change |
| --- | --- |
| `src/lib/db/client.ts` | add `BackupOps`; add `backup` to `AppDatabase` |
| `src/lib/db/browser/backup.ts` | new — `BrowserBackupOps` |
| `src/lib/db/browser/client.ts` | wire `backup` |
| `src/lib/db/native/backup.ts` | new — three bridges |
| `src/lib/db/native/client.ts` | wire `backup` |
| `src/lib/db/index.ts` | construct the browser adapter with its seams |
| `src/lib/backup/health.ts` | `getBackupHealth(meta, …)`; retire `createManualBackup` |
| `src/routes/settings/backup/+page.svelte` | delete `getRawDb`; call `db.backup` + `db.meta` |
| `src-tauri/src/database/backup.rs` | `export_backup_to`; legacy name parsing + discovery |
| `src-tauri/src/database/domains/export.rs` | seven-table CSV dump |
| `src-tauri/src/database/commands.rs` | `backup_create`, `backup_export_sqlite`, `backup_export_csv` |
| `src-tauri/src/lib.rs` | register the three commands |
| `src/lib/native/contracts.generated.ts` | regenerated |
| `src/tests/unit/native-boundary.test.ts` | three commands in the op table + fixtures |
| `src/tests/unit/backup-health.test.ts` | re-point at `db.meta` |
| `src/tests/unit/backup.test.ts` | `BackupOps` contract |
| `src-tauri/tests/backup_restore.rs` | export + legacy-discovery tests |
