# Settings → Backup on the Native Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-023

**Goal:** Make Settings → Backup & Data work on the desktop build by moving it onto the `AppDatabase` domain port, so no production page reads a raw SQL handle and every backup write goes through Rust's one crash-safe publisher.

**Architecture:** A new `BackupOps` member on the `AppDatabase` port (`create` / `exportSqlite` / `exportCsv`) implemented twice — over sql.js in the browser adapter and over three new Tauri commands in the native adapter. Health leaves the raw handle entirely by reading five `app_meta` keys through the existing `MetaOps`, so it needs no new IPC. Rust gains `export_backup_to` (a validated copy to a caller-named path, reusing publication) and teaches discovery to accept the legacy `notchy-backup-<ISO>.sqlite` routine filenames already on user disks.

**Tech Stack:** Rust (rusqlite, tauri v2, ulid), TypeScript, Svelte 5 runes, Vitest, Playwright, better-sqlite3/sql.js.

**Spec:** `specs/2026-09-29-settings-backup-native-port-design.md`

## Global Constraints

- **TDD discipline (CLAUDE.md):** write the failing test first, watch it fail, implement the minimum, then refactor. All tests pass before every commit. `pnpm test` is the pre-commit gate.
- **No new SQL surface:** `src/lib/db/client.ts` is documented as *"Exposes domain services only: no `execute`, no `transaction`, no raw SQL."* Nothing in this plan may add a query path to the port or to a page.
- **Amounts are always integers** (smallest currency unit). No floats anywhere in the CSV or export paths.
- **No schema change.** This work adds no migration and bumps no schema version, so no `importDatabase`/`validateImport` version literal changes.
- **Commit subjects must be a single line, and the commit step must use the heredoc form** (`git commit -m "$(cat <<'EOF' … EOF\n)"`). The roadmap generator parses commit subjects out of plan steps; a multi-line `-m "…"` string makes the plan read as stale.
- **Commit prefixes:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. End every commit body with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **Checkbox discipline:** the moment a task's commit lands, flip that task's step boxes `- [ ]` → `- [x]` in this file. The roadmap counts a task done only when every box is `[x]` **and** the commit is in history.
- **Paraglide flat keys:** any new copy goes in **both** `messages/en.json` and `messages/vi.json` as flat underscore keys (e.g. `settings_backup_toast_created`). Dotted IDs are rejected by Paraglide 1.11.8. Never hand-edit `src/lib/paraglide/messages/`.
- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`) — not legacy stores. IDs are ULIDs (`src/lib/utils/id.ts`).
- **Rust commands follow the domain-command pattern** (`src-tauri/src/database/commands.rs`): `State<'_, Arc<DatabaseManager>>` + `manager.data_job(...)`. They are **not** main-window guarded — `assert_main_window` is for the lifecycle commands only (`database_initialize` / `_retry` / `_status`), and no domain command uses it.
- **`data_job` requires a `Ready` boundary.** `ensure_ready()` rejects with `DatabaseUpdateRequired` from `Uninitialized` / `Initializing`, so every integration test must `manager.initialize().await.unwrap()` before exercising a data-job entry point.
- **Never resolve app directories from the `AppHandle`.** The manager already owns the authoritative paths (`manager.paths()`, `manager.backup_dir()`); `app.path().app_data_dir()` resolves to the real user directory in tests and would write outside the scratch tree. `DatabaseManager::paths()` is `pub(crate)`, so it is reachable from `commands.rs` and `executor.rs` but **not** from `src-tauri/tests/`.
- Rust commands and their TypeScript `invoke()` sites are bound together by `src/tests/unit/native-boundary.test.ts`: every production `invoke()` site must name a registered command, and every command row in the sweep asserts its camelCase arg-key set against the parsed Rust signature.

## Review Focus

The spec says what this must do; these are the inputs it does not name, and each is pinned by a test in the task that owns the code.

1. **An export target the app cannot write** (directory deleted, path on a read-only mount, a file where a directory is expected). A person expects a localized error toast and their existing file left alone — never a crash, a truncated file, or a silent success. → Task 1.
2. **A backup file already on disk with the name about to be written** (re-exporting to the same path, or two "Create backup now" presses in the same second). A person expects the newer file, not a failure and not two half-written files. → Task 1 (export must replace) and Task 5 (create must not).
3. **A legacy routine backup whose schema is outside the manifest range**, or whose bytes are corrupt. A person expects the recovery screen to still open and list the other backups — one bad file must not empty the list, panic, or displace a verified recovery point. → Task 2.
4. **A CSV cell containing a quote, a comma, or a newline**, and a cell starting with `=`, `+`, `-`, or `@`. A person expects the file to reopen correctly in a spreadsheet with the text intact and no formula executed. → Task 3.
5. **A table with zero rows** (a fresh ledger has no transactions). A person expects the exported file to exist rather than silently vanish, so "I exported 7 tables" is true. → Task 3.

---

### Task 1: Export a validated copy to a caller-named path

Rust only. No wiring — this task splits one function and adds another, and its tests are pure filesystem work against the existing fixtures.

**Files:**
- Modify: `src-tauri/src/database/backup.rs` (split `publish_backup` at `:143` into a delegating public wrapper plus `publish_backup_named`; add `export_backup_to`)
- Test: `src-tauri/tests/backup_restore.rs`

**Interfaces:**
- Consumes: `publish_backup` (`backup.rs:143`) and its protocol; `final_backup_name` (`backup.rs:298`); `BackupFailurePoint` (`backup.rs:60`); `BackupToken`; `create_dir_private`; `open_read_only_at`; `read_source_meta`; `validate_manifest`. Test helpers `scratch_root`, `fixtures_dir`, `TEMP_PREFIX`, `FINAL_PREFIX` are already defined in `backup_restore.rs`.
- Produces: `pub fn export_backup_to(source_path: &Path, target_path: &Path) -> DbResult<PathBuf>` — writes a validated copy of the database at `source_path` to exactly `target_path`, **replacing any existing file**. Task 5 wraps it as the `backup_export_sqlite` command.

- [x] **Step 1: Write the failing tests**

Append to `src-tauri/tests/backup_restore.rs`. Add `export_backup_to` to the existing `notchy_lib::database::backup::{…}` import, and add this import below it:

```rust
use notchy_lib::database::manifest::validate_manifest;
```

```rust
// ---------------------------------------------------------------------------
// export_backup_to (Task 1): a validated copy at a caller-named path
// ---------------------------------------------------------------------------

/// A verified source database, copied out of the fixtures so the test can point
/// an export at a target without touching the committed fixture.
fn source_db(tag: &str) -> PathBuf {
    let root = scratch_root(tag);
    std::fs::create_dir_all(&root).unwrap();
    let source = root.join("live.sqlite");
    std::fs::copy(fixtures_dir().join("v004.sqlite"), &source).unwrap();
    source
}

/// A scratch directory that exists, for use as an export target's parent.
fn target_dir(tag: &str) -> PathBuf {
    let dir = scratch_root(tag);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn temp_files_in(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(TEMP_PREFIX))
        .collect()
}

#[test]
fn export_writes_a_validated_copy_at_the_exact_target_path() {
    let source = source_db("export-ok");
    let target = target_dir("export-ok-target").join("notchy-2026-09-29.sqlite");

    let written = export_backup_to(&source, &target).unwrap();

    assert_eq!(written, target);
    // The copy is a real database, not a byte blob: it opens and validates.
    let connection = rusqlite::Connection::open(&target).unwrap();
    validate_manifest(&connection, 4).unwrap();
}

#[test]
fn export_replaces_an_existing_target() {
    let source = source_db("export-replace");
    let dir = target_dir("export-replace-target");
    let target = dir.join("notchy.sqlite");
    std::fs::write(&target, b"stale bytes").unwrap();

    export_backup_to(&source, &target).unwrap();

    // Replacing is expected: the save dialog has already asked the user.
    let connection = rusqlite::Connection::open(&target).unwrap();
    validate_manifest(&connection, 4).unwrap();
    assert!(temp_files_in(&dir).is_empty(), "temp left behind");
}

#[test]
fn export_refuses_a_corrupt_source_and_preserves_the_existing_target() {
    let dir = target_dir("export-corrupt");
    let source = dir.join("corrupt.sqlite");
    std::fs::write(&source, b"not a database").unwrap();
    let target = dir.join("keep-me.sqlite");
    std::fs::write(&target, b"original bytes").unwrap();

    let result = export_backup_to(&source, &target);

    assert!(result.is_err(), "a corrupt source must not produce a backup");
    assert_eq!(std::fs::read(&target).unwrap(), b"original bytes");
    assert!(temp_files_in(&dir).is_empty(), "a failed export must leave no temp");
}

#[test]
fn export_leaves_only_the_target_in_its_directory() {
    // The staged temp lives beside the target, so the final rename stays on one
    // filesystem and a successful export sweeps its own scratch file.
    let source = source_db("export-elsewhere");
    let dir = target_dir("export-elsewhere-target");
    let target = dir.join("chosen.sqlite");

    export_backup_to(&source, &target).unwrap();

    assert!(target.exists());
    assert_eq!(
        std::fs::read_dir(&dir).unwrap().flatten().count(),
        1,
        "only the target should remain"
    );
}

#[test]
fn export_is_not_a_discovered_backup() {
    let source = source_db("export-not-discovered");
    let dir = target_dir("export-not-discovered-target");

    export_backup_to(&source, &dir.join("notchy-export.sqlite")).unwrap();

    // An export is named by the user, so it must never masquerade as a
    // recovery point.
    let discovered = discover_verified_backups(&dir).unwrap();
    assert!(
        discovered.is_empty(),
        "export leaked into discovery: {discovered:?}"
    );
}
```

`ulid` is already a `[dependencies]` entry and integration tests link the package's normal dependencies (other suites import `rusqlite` directly), so `ulid::Ulid` is available here.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test backup_restore export`
Expected: FAIL to compile — `cannot find function 'export_backup_to' in this scope`. A compile failure is the red state for a new Rust function.

- [x] **Step 3: Let a caller name the file**

In `src-tauri/src/database/backup.rs`, rename the existing `publish_backup` body to `publish_backup_named` and append a parameter:

```rust
/// Publish a verified, durable backup whose final filename is chosen by the
/// caller.
///
/// `name: None` derives the published-backup name from the source's own schema
/// and app version; `Some(name)` is used verbatim. Either way the copy is staged
/// in a temp file beside the target, validated, `fsync`ed, and renamed
/// atomically.
fn publish_backup_named(
    source_path: &Path,
    backup_dir: &Path,
    name: Option<&str>,
    failpoint: BackupFailurePoint,
) -> DbResult<BackupToken> {
```

Two regions inside that body change. The naming block that currently reads

```rust
        let target = backup_dir.join(final_backup_name(schema_version, &app_version));
        // The final name embeds a fresh ULID, so a collision means the same
        // millisecond produced two publications; never overwrite a verified
        // backup.
        if target.exists() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
```

becomes

```rust
        let caller_named = name.is_some();
        let final_name = match name {
            Some(name) => name.to_string(),
            None => final_backup_name(schema_version, &app_version),
        };
        let target = backup_dir.join(final_name);
        // A derived name embeds a fresh ULID, so a collision means the same
        // millisecond produced two publications; never overwrite a verified
        // backup. A caller-named target is an explicit choice — the save dialog
        // already asked — and replacing it is the point.
        if !caller_named && target.exists() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
```

(`caller_named` is read before the `match` so `name` can be moved into it.)

Then rename the doc comment's opening line from `publish_backup` to
`publish_backup_named`, and add the public wrapper with the original signature
and the original doc comment:

```rust
/// Publish a verified, durable backup of `source_path` into `backup_dir`,
/// named from the source's own schema and app version.
///
/// The publication sequence is: online copy to a unique `.tmp` file, validate
/// the source-version manifest (integrity + foreign keys) on the copy, `fsync`
/// the file, atomically rename to the final name, then `fsync` the directory.
/// Any failure before the final `fsync` removes the temp and final files, so a
/// partial backup is never visible. On success an opaque [`BackupToken`]
/// bound to the canonical path, source schema, and content fingerprint is
/// returned.
pub fn publish_backup(
    source_path: &Path,
    backup_dir: &Path,
    failpoint: BackupFailurePoint,
) -> DbResult<BackupToken> {
    publish_backup_named(source_path, backup_dir, None, failpoint)
}
```

- [x] **Step 4: Add `export_backup_to`**

Below the wrapper in the same file:

```rust
/// Write a validated copy of the database at `source_path` to exactly
/// `target_path`, replacing any existing file.
///
/// Same publication protocol as [`publish_backup`] — online copy, manifest
/// validation, `fsync`, atomic rename, directory `fsync` — but the caller names
/// the file. The staged temp lives beside the target, so the final rename stays
/// on one filesystem and an interrupted export leaves a temp that
/// [`cleanup_interrupted_publications`] already knows how to sweep. A failure
/// before the rename leaves an existing target untouched.
///
/// The returned path is `target_path` itself, which carries none of the
/// publication ULID: exports are user-named artifacts, not recovery points, and
/// discovery ignores them.
pub fn export_backup_to(source_path: &Path, target_path: &Path) -> DbResult<PathBuf> {
    let backup_dir = target_path
        .parent()
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    publish_backup_named(
        source_path,
        backup_dir,
        Some(file_name),
        BackupFailurePoint::None,
    )?;
    Ok(target_path.to_path_buf())
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test backup_restore`
Expected: PASS — the five new tests plus every pre-existing publication, failpoint, discovery, retention, and cleanup test, which guard the `publish_backup` delegation.

- [x] **Step 6: Lint and commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings.

```bash
git add src-tauri/src/database/backup.rs src-tauri/tests/backup_restore.rs
git commit -m "$(cat <<'EOF'
feat(backup): export a validated copy to a caller-named path

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Discover legacy routine backups

Rust only. Routine backups written before this change are named `notchy-backup-<ISO>.sqlite`, which discovery rejects — so the files a user already has are invisible to the recovery screen.

**Files:**
- Modify: `src-tauri/src/database/backup.rs` (`parse_backup_name` at `:321`, `ParsedBackupName` at `:351`, `scan_verified_backups` at `:381`)
- Test: `src-tauri/tests/backup_restore.rs`

**Interfaces:**
- Consumes: `read_source_meta` (`backup.rs:243`) — returns `(i64, String)` and already falls back to `UNKNOWN_APP_VERSION` when the key is absent; `manifest_for` (`manifest.rs:546`); `validate_manifest` (`manifest.rs:628`); `open_read_only_at`; `format_ulid_timestamp`; `FINAL_SUFFIX`; `TEMP_PREFIX`.
- Produces: `enum BackupName { Published(ParsedBackupName), Legacy { created_ms: u64 } }` — the return of the still-private `parse_backup_name`, plus the private `parse_published_name` (the old body) and `parse_legacy_stamp`. `discover_verified_backups` gains verified legacy routine backups; its signature and `BackupSummary` shape are unchanged, so no caller changes.

The legacy filename shape is the exact output of the old JS writer — `new Date().toISOString().replace(/[:.]/g, '-')`, which is `YYYY-MM-DDTHH-MM-SS-mmmZ` (24 characters, e.g. `notchy-backup-2026-08-19T14-22-31-123Z.sqlite`). Check it by position **and** by value: the seven fields must name a real instant (month `1..=12`, day `1..=days_in_month(year, month)`, hour `<= 23`, minute `<= 59`, second `<= 59`, and not pre-epoch). A malformed or impossible stamp is not a candidate. The record's `id` comes from the **filename stamp** via `Ulid::from_datetime`, so ordering against ULID-named records stays chronological and `format_ulid_timestamp` round-trips — never from the file's mtime, which survives a rename but is reset by a copy, an unzip, or a move to a new machine, and would put an old backup above a genuinely newer one on the recovery screen.

- [x] **Step 1: Write the failing tests**

Append to `src-tauri/tests/backup_restore.rs`. Add this import below the existing `notchy_lib` imports — Task 2's tests derive a published timestamp with `Ulid::from_datetime`:

```rust
use ulid::Ulid;
```

```rust
// ---------------------------------------------------------------------------
// Legacy routine-name discovery (Task 2)
// ---------------------------------------------------------------------------

/// The timestamp shape the pre-port JS writer produced.
const LEGACY_STAMP: &str = "2026-08-19T14-22-31-123Z";

fn legacy_name(stamp: &str) -> String {
    format!("notchy-backup-{stamp}.sqlite")
}

/// Copy a fixture into `dir` under a legacy routine filename, pinning the mtime
/// so ordering assertions are deterministic.
fn legacy_backup(dir: &Path, name: &str, mtime_secs: u64) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    std::fs::copy(fixtures_dir().join("v004.sqlite"), &path).unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(UNIX_EPOCH + Duration::from_secs(mtime_secs))
        .unwrap();
    path
}

#[test]
fn discovery_accepts_a_legacy_routine_backup_name() {
    let dir = scratch_root("legacy-accept");
    let path = legacy_backup(&dir, &legacy_name(LEGACY_STAMP), 1_755_600_000);

    let found = discover_verified_backups(&dir).unwrap();

    assert_eq!(found.len(), 1, "legacy routine backup must be discoverable");
    let canonical = std::fs::canonicalize(&path).unwrap();
    assert_eq!(found[0].path, canonical.to_string_lossy());
    // The name carries no schema, so it comes from the file's own app_meta.
    assert_eq!(found[0].schema_version, 4);
    assert!(found[0].verified);
    // The name's stamp, not the file's mtime, which is pinned a year earlier.
    assert_eq!(
        Ulid::from_string(&found[0].id).unwrap().timestamp_ms(),
        1_787_149_351_123,
        "the id must come from the filename stamp, not the file's mtime"
    );
    assert_eq!(found[0].created_at, "2026-08-19T14:22:31.123Z");
    assert_eq!(found[0].id.len(), 26, "id is a ULID derived from the stamp");
}

#[test]
fn discovery_rejects_names_that_are_not_the_legacy_shape() {
    let dir = scratch_root("legacy-reject");
    for name in [
        "notchy-backup-notadate.sqlite",
        "notchy-backup-2026-08-19.sqlite",
        "notchy-backup-2026-08-19T14-22-31-123.sqlite",
        "notchy-backup-2026-08-19T14-22-31-123Z.db",
        "notchy-backup-vX-0.1.4-01M3CGSB1ASS5VDMKWMHXE4HVJ.sqlite",
    ] {
        legacy_backup(&dir, name, 1_755_600_000);
    }

    let found = discover_verified_backups(&dir).unwrap();

    assert!(
        found.is_empty(),
        "non-shape names must not be candidates: {found:?}"
    );
}

#[test]
fn discovery_rejects_a_legacy_backup_whose_stamp_is_not_a_real_instant() {
    let dir = scratch_root("legacy-bad-instant");
    // Copies of the *valid* fixture: accepting either name would produce a
    // verified record, so an empty result cannot be vacuous.
    for name in [
        // Correct shape, impossible fields.
        legacy_name("2026-99-99T99-99-99-999Z"),
        // A real date, but pre-epoch: `new Date().toISOString()` cannot
        // produce it.
        legacy_name("0000-01-01T00-00-00-000Z"),
    ] {
        legacy_backup(&dir, &name, 1_755_600_000);
    }

    let found = discover_verified_backups(&dir).unwrap();

    assert!(
        found.is_empty(),
        "a stamp that is not a real instant must not be a candidate: {found:?}"
    );
}

#[test]
fn discovery_skips_a_legacy_backup_with_a_corrupt_body() {
    let dir = scratch_root("legacy-corrupt");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(legacy_name(LEGACY_STAMP)), b"not a database").unwrap();
    let published = dir.join(format!(
        "notchy-backup-v4-0.1.4-{}.sqlite",
        Ulid::from_datetime(UNIX_EPOCH + Duration::from_secs(1_755_604_800))
    ));
    std::fs::copy(fixtures_dir().join("v004.sqlite"), &published).unwrap();

    let found = discover_verified_backups(&dir).unwrap();

    assert_eq!(
        found.len(),
        1,
        "a corrupt candidate must not displace a verified one"
    );
    assert!(found[0].path.ends_with("notchy-backup-v4-0.1.4-"));
}

#[test]
fn legacy_and_published_backups_sort_together_newest_first() {
    let dir = scratch_root("legacy-order");
    // The legacy stamp's instant is the older one; the published ULID encodes
    // one an hour later. The legacy file's mtime is pinned *later still*, so an
    // implementation that ordered by mtime would put the legacy file first and
    // fail — the mtime fixture is deliberately adversarial.
    let legacy_path = legacy_backup(&dir, &legacy_name(LEGACY_STAMP), 1_787_149_351 + 7_200);
    let published = dir.join(format!(
        "notchy-backup-v4-0.1.4-{}.sqlite",
        Ulid::from_datetime(UNIX_EPOCH + Duration::from_millis(1_787_149_351_123 + 3_600_000))
    ));
    std::fs::copy(fixtures_dir().join("v004.sqlite"), &published).unwrap();

    let found = discover_verified_backups(&dir).unwrap();

    assert_eq!(found.len(), 2);
    assert!(
        found[0].path.contains("notchy-backup-v4-0.1.4-"),
        "the published record is the newer one: {found:?}"
    );
    assert_eq!(found[1].created_at, "2026-08-19T14:22:31.123Z");
    assert!(
        found[0].created_at > found[1].created_at,
        "newest first: {found:?}"
    );
    assert!(std::fs::canonicalize(&legacy_path).is_ok());
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test backup_restore legacy`
Expected: FAIL — `discovery_accepts_a_legacy_routine_backup_name` panics with `assertion left == right failed … left: 0, right: 1`, and `legacy_and_published_backups_sort_together_newest_first` panics with `left: 1, right: 2`.

- [x] **Step 3: Widen the parser**

In `src-tauri/src/database/backup.rs`, add the legacy prefix constant next to `FINAL_PREFIX`:

```rust
/// Legacy routine-backup filename prefix, written by the pre-port JS path:
/// `notchy-backup-<ISO timestamp>.sqlite`.
const LEGACY_PREFIX: &str = "notchy-backup-";
```

Replace `parse_backup_name`'s signature and doc comment, keeping its existing body as `parse_published_name`:

```rust
/// Parse one candidate's discovery metadata from its filename.
///
/// Filename parsing is discovery metadata, never proof: the caller must still
/// revalidate the candidate.
///
/// Two shapes are accepted:
/// - `notchy-backup-v<schema>-<app-version>-<ULID>.sqlite` — the published
///   shape, carrying every field in the name.
/// - `notchy-backup-<ISO timestamp>.sqlite` — the legacy routine shape from the
///   pre-port JS writer, which carries no schema, app version, or ULID: the
///   first two come from the file and the third from the name's timestamp.
///
/// Returns `None` for anything matching neither shape.
fn parse_backup_name(name: &str) -> Option<BackupName> {
    if let Some(published) = parse_published_name(name) {
        return Some(BackupName::Published(published));
    }
    let stamp = name
        .strip_suffix(FINAL_SUFFIX)?
        .strip_prefix(LEGACY_PREFIX)?;
    parse_legacy_stamp(stamp).map(|created_ms| BackupName::Legacy { created_ms })
}

/// Parse the published-backup shape. This is the original `parse_backup_name`
/// body, unchanged.
fn parse_published_name(name: &str) -> Option<ParsedBackupName> {
```

Delete the old `parse_backup_name` doc comment (it now lives on the wrapper). Then insert above `struct ParsedBackupName`:

```rust
/// A candidate's discovery metadata source.
enum BackupName {
    /// The published shape: schema, app version, and ULID all come from the name.
    Published(ParsedBackupName),
    /// The legacy routine shape: the schema and app version come from the file,
    /// and the record's time — `created_ms` since the Unix epoch — from the
    /// name's stamp.
    Legacy { created_ms: u64 },
}

/// Parse a legacy routine stamp to epoch milliseconds.
///
/// The stamp is `notchy-backup-` + `YYYY-MM-DDTHH-MM-SS-mmmZ`. Shape is checked
/// by position, then the seven fields are checked as an instant: a well-shaped
/// stamp naming an impossible date (`2026-99-99T99-99-99-999Z`) or a pre-epoch
/// time is not a candidate, because the record's ULID is derived from this
/// value and `new Date().toISOString()` cannot produce one. A near-miss
/// (`notchy-backup-notadate.sqlite`, a bare date, a missing `Z`) is not a
/// candidate either.
fn parse_legacy_stamp(stamp: &str) -> Option<u64> {
    let bytes = stamp.as_bytes();
    if bytes.len() != 24 || bytes[10] != b'T' || bytes[23] != b'Z' {
        return None;
    }
    for (index, byte) in bytes.iter().enumerate() {
        if index == 10 || index == 23 {
            // The 'T' and 'Z' separators, already checked above.
            continue;
        }
        if matches!(index, 4 | 7 | 13 | 16 | 19) {
            if *byte != b'-' {
                return None;
            }
        } else if !byte.is_ascii_digit() {
            return None;
        }
    }
    let year: i64 = stamp.get(0..4)?.parse().ok()?;
    let field = |start: usize| -> Option<i64> { stamp.get(start..start + 2)?.parse().ok() };
    let month = field(5)?;
    let day = field(8)?;
    let hour = field(11)?;
    let minute = field(14)?;
    let second = field(17)?;
    let millis: i64 = stamp.get(20..23)?.parse().ok()?;

    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month as u32) as i64 {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let seconds = days_from_civil(year, month as u32, day as u32) * 86_400
        + hour * 3_600
        + minute * 60
        + second;
    if seconds < 0 {
        return None;
    }
    Some(seconds as u64 * 1_000 + millis as u64)
}
```

`days_in_month(year, month)` (leap-year aware) and `days_from_civil(year, month, day)` — the
inverse of the `civil_from_days` already in this file, Howard Hinnant's algorithm — sit beside
`civil_from_days` in the time-helper section.

- [x] **Step 4: Fill legacy records from the file**

Replace the body of the `for entry in entries.flatten()` loop in `scan_verified_backups`, and update its doc comment to mention both shapes:

```rust
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(backup_name) = parse_backup_name(name) else {
            continue;
        };
        // A legacy name carries no schema, so the file has to be open before
        // the manifest can be selected. An unreadable candidate is still
        // skipped, and a schema with no manifest is still rejected before
        // validation — the name remains a hint, never a verdict.
        let Ok(connection) = open_read_only_at(&path) else {
            continue;
        };
        let (schema_version, source_app_version, id) = match backup_name {
            BackupName::Published(parsed) => (parsed.schema, parsed.app_version, parsed.ulid),
            BackupName::Legacy { created_ms } => {
                let Ok((schema, app_version)) = read_source_meta(&connection) else {
                    continue;
                };
                // The record's time is the name's, never the file's: an mtime
                // survives a rename but is reset by a copy, an unzip, or a move
                // to a new machine, which would put an old backup above a
                // genuinely newer one on the recovery screen.
                (
                    schema,
                    app_version,
                    Ulid::from_datetime(UNIX_EPOCH + Duration::from_millis(created_ms)).to_string(),
                )
            }
        };
        if manifest_for(schema_version).is_none() {
            continue;
        }
        if validate_manifest(&connection, schema_version).is_err() {
            continue;
        }
        drop(connection);
        let Ok(canonical) = std::fs::canonicalize(&path) else {
            continue;
        };
        records.push(BackupSummary {
            id: id.clone(),
            path: canonical.to_string_lossy().into_owned(),
            schema_version,
            source_app_version,
            created_at: format_ulid_timestamp(&id),
            verified: true,
        });
    }
```

Add `use ulid::Ulid;` to the module imports. The file currently calls `ulid::Ulid::from_string` by full path in `parse_published_name` and `format_ulid_timestamp`; leave those alone — the import is additive and both still resolve.

- [x] **Step 5: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — including the five new legacy tests (discovery accepts the legacy name, rejects non-shape names, rejects a stamp that is not a real instant, skips a corrupt body, and orders legacy against published newest-first) and every pre-existing discovery test (a corrupt file with a matching name still cannot displace a verified backup).

- [x] **Step 6: Lint and commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

```bash
git add src-tauri/src/database/backup.rs src-tauri/tests/backup_restore.rs
git commit -m "$(cat <<'EOF'
feat(backup): discover legacy routine backup filenames

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The seven-table CSV dump

Rust only, in the existing export domain. This is a new native implementation of the set the JS dump produces, not the flat report.

**Files:**
- Modify: `src-tauri/src/database/domains/export.rs` (adds `TABLE_SET` and `export_table_set_csv` beside `export_transactions_csv` at `:58`)
- Test: `src-tauri/tests/domain_reports_export.rs`

**Interfaces:**
- Consumes: `sanitize_csv_cell` (`export.rs:19`), `csv_escape` (`export.rs:34`), `map_sqlite_error`, `DbError`/`ErrorCode`. The test harness in `domain_reports_export.rs` provides `scratch_path(tag)`, `fresh_db(tag)`, `make_account(&mut Connection, name, kind)`, `make_tx(&mut Connection, kind, amount, date, account_id, tag_id)`, and already imports `notchy_lib::database::domains::{categories, export, reports}`.
- Produces: `pub fn export_table_set_csv(conn: &Connection, dir: &Path) -> DbResult<Vec<String>>` — writes `<dir>/<table>.csv` for each of the seven tables and returns the written paths in [`TABLE_SET`] order. Task 5 wraps it as the `backup_export_csv` command.

Parity with the JS `exportCsv` (`src/lib/backup/index.ts:105`) is the requirement, and it is close: the same seven tables in the same order, the same raw stored values (the JS dump writes `String(row[header] ?? '')`, so amounts stay integers — **not** the `format_amount` decimal form that `export_transactions_csv` uses), the same `WHERE deleted_at IS NULL` filter, and the same cell escaping — the JS `csvEscape` prefixes `'` for a leading `= + - @ \t \r` and quotes on `,`/`"`/`\n`, exactly what `sanitize_csv_cell` does. **One deliberate difference:** for a table with no rows the JS dump returns an empty string, so the page wrote no file for it; this implementation always writes a header line, so the export is a complete, self-describing set of seven files.

Table order must match the JS array: `accounts`, `category_types`, `category_tags`, `transactions`, `budgets`, `goals`, `reconciliations`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/domain_reports_export.rs` (add `use std::path::Path;` to the existing `use std::path::PathBuf;`):

```rust
// ---------------------------------------------------------------------------
// export_table_set_csv (Task 3)
// ---------------------------------------------------------------------------

/// A migrated database plus a scratch directory to export into.
fn fresh_db_and_dir(tag: &str) -> (Connection, PathBuf) {
    let dir = scratch_path(tag).parent().unwrap().join("export");
    (fresh_db(tag), dir)
}

fn read_export(dir: &Path, table: &str) -> String {
    std::fs::read_to_string(dir.join(format!("{table}.csv"))).unwrap()
}

#[test]
fn table_set_export_writes_seven_files_in_order() {
    let (conn, dir) = fresh_db_and_dir("csv-set");
    let written = export::export_table_set_csv(&conn, &dir).unwrap();

    let names: Vec<String> = written
        .iter()
        .map(|path| {
            Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(
        names,
        vec![
            "accounts.csv",
            "category_types.csv",
            "category_tags.csv",
            "transactions.csv",
            "budgets.csv",
            "goals.csv",
            "reconciliations.csv",
        ]
    );
    for path in &written {
        assert!(Path::new(path).exists(), "missing: {path}");
    }
}

#[test]
fn table_set_export_writes_headers_even_for_an_empty_table() {
    let (conn, dir) = fresh_db_and_dir("csv-empty");
    export::export_table_set_csv(&conn, &dir).unwrap();

    // A fresh ledger has no goals; the file must still exist and describe them,
    // so "I exported 7 tables" is true.
    let goals = read_export(&dir, "goals");
    let header = goals.lines().next().unwrap_or_default();
    assert!(header.starts_with("id,"), "header-only file expected, got {header:?}");
    assert_eq!(goals.lines().count(), 1, "no data rows expected");
}

#[test]
fn table_set_export_writes_raw_integer_amounts() {
    let (mut conn, dir) = fresh_db_and_dir("csv-amounts");
    let account = make_account(&mut conn, "Cash", "checking");
    make_tx(&mut conn, "expense", 123_456, "2026-02-01", &account, None);

    export::export_table_set_csv(&conn, &dir).unwrap();

    let transactions = read_export(&dir, "transactions");
    // The stored integer, not the formatted "1234.56" that the flat
    // transactions report writes.
    assert!(transactions.contains("123456"), "expected raw integer: {transactions}");
    assert!(!transactions.contains("1234.56"), "amount must not be reformatted");
}

#[test]
fn table_set_export_omits_soft_deleted_rows() {
    let (mut conn, dir) = fresh_db_and_dir("csv-soft-delete");
    let account = make_account(&mut conn, "Doomed", "checking");
    conn.execute(
        "UPDATE accounts SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1",
        params![account],
    )
    .unwrap();

    export::export_table_set_csv(&conn, &dir).unwrap();

    let accounts = read_export(&dir, "accounts");
    assert!(!accounts.contains("Doomed"), "soft-deleted row leaked: {accounts}");
}

#[test]
fn table_set_export_neutralizes_formula_cells_and_escapes_delimiters() {
    let (mut conn, dir) = fresh_db_and_dir("csv-injection");
    let account = make_account(&mut conn, "Escapes", "checking");
    let formula = make_tx(&mut conn, "expense", 1, "2026-02-01", &account, None);
    let delimited = make_tx(&mut conn, "expense", 2, "2026-02-02", &account, None);
    conn.execute(
        "UPDATE transactions SET payee = ?1 WHERE id = ?2",
        params!["=cmd|'/c calc'!A1", formula],
    )
    .unwrap();
    conn.execute(
        "UPDATE transactions SET payee = ?1 WHERE id = ?2",
        params!["Smith, \"Bob\"\nJr", delimited],
    )
    .unwrap();

    export::export_table_set_csv(&conn, &dir).unwrap();

    let transactions = read_export(&dir, "transactions");
    assert!(transactions.contains("'=cmd"), "formula not neutralized: {transactions}");
    assert!(
        transactions.contains("\"Smith, \"\"Bob\"\"\nJr\""),
        "RFC 4180 escaping missing: {transactions}"
    );
}
```

`make_tx` does not set a payee, which is why the two cells are written by `UPDATE` afterwards. If `transactions` has no `payee` column in this schema, substitute a text column that does exist — a failing run prints the header line with the real column names, and the assertion is about escaping, not about payees.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reports_export table_set`
Expected: FAIL to compile — `no function or associated item named 'export_table_set_csv' found for module 'export'`.

- [ ] **Step 3: Implement the dump**

In `src-tauri/src/database/domains/export.rs`, add `use std::path::Path;` and `use crate::database::error::ErrorCode;`, then:

```rust
/// The tables the Settings → Backup & Data export writes, in the order the
/// pre-port JS export produced them.
pub const TABLE_SET: [&str; 7] = [
    "accounts",
    "category_types",
    "category_tags",
    "transactions",
    "budgets",
    "goals",
    "reconciliations",
];

/// Write one CSV per table into `dir`, replacing existing files, and return the
/// written paths in [`TABLE_SET`] order.
///
/// This is a database dump, not the formatted transactions report: `SELECT *`
/// column order, raw stored values (amounts stay integers), soft-deleted rows
/// excluded, and every cell passed through the shared cell sanitizer so a payee
/// cannot become a spreadsheet formula. A table with no rows still gets a file,
/// with its header line, so the export is a complete set.
pub fn export_table_set_csv(conn: &Connection, dir: &Path) -> DbResult<Vec<String>> {
    std::fs::create_dir_all(dir).map_err(|_| DbError::new(ErrorCode::InvalidInput))?;
    let mut written = Vec::with_capacity(TABLE_SET.len());
    for table in TABLE_SET {
        // Table names come from the fixed constant above, never from input.
        let mut statement = conn
            .prepare(&format!("SELECT * FROM {table} WHERE deleted_at IS NULL"))
            .map_err(map_sqlite_error)?;
        let headers: Vec<String> = statement
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect();
        let mut lines = vec![headers.join(",")];
        let mut rows = statement.query([]).map_err(map_sqlite_error)?;
        while let Some(row) = rows.next().map_err(map_sqlite_error)? {
            let mut cells = Vec::with_capacity(headers.len());
            for (index, header) in headers.iter().enumerate() {
                let value = row
                    .get::<_, rusqlite::types::Value>(index)
                    .map_err(map_sqlite_error)?;
                // NULL is the empty cell, matching the JS `?? ''`. Integers are
                // written verbatim; the schema has no REAL columns.
                let text = match value {
                    rusqlite::types::Value::Null => String::new(),
                    rusqlite::types::Value::Integer(number) => number.to_string(),
                    rusqlite::types::Value::Real(number) => number.to_string(),
                    rusqlite::types::Value::Text(text) => text,
                    rusqlite::types::Value::Blob(bytes) => {
                        String::from_utf8_lossy(&bytes).into_owned()
                    }
                };
                cells.push(sanitize_csv_cell(header, &text));
            }
            lines.push(cells.join(","));
        }
        let path = dir.join(format!("{table}.csv"));
        std::fs::write(&path, lines.join("\n"))
            .map_err(|_| DbError::new(ErrorCode::InvalidInput))?;
        written.push(path.to_string_lossy().into_owned());
    }
    Ok(written)
}
```

Read `sanitize_csv_cell` at `export.rs:19` and match its declared parameter list — if it takes only the cell value, drop the `header` argument here. If it does not itself quote for delimiters, route the value through `csv_escape` on the way out, exactly as `export_transactions_csv` composes them; the two helpers must compose the same way in both writers for the escaping test to hold.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reports_export`
Expected: PASS — the five new tests plus the pre-existing `sanitize_csv_cell` and transactions-report tests.

- [ ] **Step 5: Lint and commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

```bash
git add src-tauri/src/database/domains/export.rs src-tauri/tests/domain_reports_export.rs
git commit -m "$(cat <<'EOF'
feat(export): write the seven-table CSV dump in Rust

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Retire the dead native backup-health contracts

`BackupHealth` and `BackupHealthOptions` are declared in Rust, emitted into the committed TypeScript contracts (`src/lib/native/contracts.generated.ts:80-81`), and used by nothing — no command constructs them and no TypeScript file imports them. They are the shape of a native health command that was never built. This plan's health path is JavaScript over `MetaOps` (Task 7), so leaving them makes the generated contracts advertise a surface that does not exist.

**Files:**
- Modify: `src-tauri/src/database/types.rs` (`BackupHealth` at `:831`, `BackupHealthOptions` at `:841`)
- Modify: `src-tauri/src/database/mod.rs:45` (re-export list)
- Modify: `src-tauri/src/database/commands.rs:1016-1017` (the two `push_decl` calls)
- Regenerate: `src/lib/native/contracts.generated.ts`
- Test: `src-tauri/tests/contracts.rs`

**Interfaces:**
- Consumes: the bindings generator in `src-tauri/src/bin/export_bindings.rs`, reached via `pnpm generate:db-contracts` / `pnpm check:db-contracts`.
- Produces: nothing new. After this task the generated contracts contain no `BackupHealth` type. Task 7's `BackupHealth` is the TypeScript interface in `src/lib/backup/health.ts`, which is unrelated and untouched.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/contracts.rs`, calling the generator the same way that file's existing tests do (they build the contract text with the same function `export_bindings` uses):

```rust
#[test]
fn native_backup_health_contracts_are_not_declared_without_a_command() {
    let bindings = generate_bindings();

    // Health is computed in JS from app_meta; a native health command does not
    // exist, so its type must not be advertised in the committed contracts.
    assert!(
        !bindings.contains("BackupHealth"),
        "a backup-health contract with no constructing command is drift"
    );
}
```

Use the same import path for the generator that the top of `contracts.rs` already uses; the existing tests in that file are the reference for the exact name.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test contracts native_backup_health`
Expected: FAIL — `a backup-health contract with no constructing command is drift`.

- [ ] **Step 3: Delete the dead types and their declarations**

Remove both structs and their doc comments from `src-tauri/src/database/types.rs` (the `BackupHealth` and `BackupHealthOptions` definitions around lines 831-845), remove `BackupHealth, BackupHealthOptions` from the re-export list in `src-tauri/src/database/mod.rs:45`, and delete these two lines from `src-tauri/src/database/commands.rs`:

```rust
    push_decl(&mut out, BackupHealth::decl(&cfg));
    push_decl(&mut out, BackupHealthOptions::decl(&cfg));
```

Leave `BackupSummary` and `BackupToken` alone — they are used by discovery and restore.

- [ ] **Step 4: Regenerate the contracts and run the tests**

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`
Expected: bindings written, then `bindings are current`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `pnpm test && pnpm check`
Expected: PASS — nothing in TypeScript imported those types.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/database/types.rs src-tauri/src/database/mod.rs src-tauri/src/database/commands.rs src-tauri/tests/contracts.rs src/lib/native/contracts.generated.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): drop the unbuilt native backup-health types

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The three backup commands

Rust commands plus the manager method that owns the "record only after success" invariant. Nothing TypeScript yet, so the boundary test's inverse check (every `invoke()` site names a registered command) stays green — there are no new call sites until Task 6.

**Files:**
- Modify: `src-tauri/src/database/executor.rs` (add `create_routine_backup` to `DatabaseManager`, beside `backup_dir()` at `:243`)
- Modify: `src-tauri/src/database/commands.rs` (three commands, after the report commands)
- Modify: `src-tauri/src/lib.rs` (`generate_handler!` list)
- Test: `src-tauri/tests/command_guards.rs`

**Interfaces:**
- Consumes: `publish_backup` (Task 1 left it a delegation), `export_backup_to` (Task 1), `export_table_set_csv` (Task 3), `domains::get_meta` / `domains::set_meta` (`domains/meta.rs:18`, `:31`, both `pub` and re-exported at `domains/mod.rs:33`), `now_iso_utc()` (`migrations.rs:626`, `pub(crate)`), `manager.paths()` (`pub(crate)`), `manager.backup_dir()` (returns `PathBuf`), `manager.data_job` (`pub`).
- Produces, for Task 6's TypeScript bridges:
  - `backup_create(manager: State<'_, Arc<DatabaseManager>>) -> Result<String, DbError>` — returns the canonical path of the published backup; no arguments.
  - `backup_export_sqlite(target_path: String, manager: State<'_, Arc<DatabaseManager>>) -> Result<(), DbError>` — camelCase arg key `targetPath`.
  - `backup_export_csv(dir: String, manager: State<'_, Arc<DatabaseManager>>) -> Result<Vec<String>, DbError>` — camelCase arg key `dir`.
  - `DatabaseManager::create_routine_backup(&self) -> DbResult<String>`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/command_guards.rs`. Add `scratch_root` to its existing `use common::{…}` list, add `backup_create, backup_export_csv, backup_export_sqlite` to the `use notchy_lib::database::commands::{…}` list, and add `use notchy_lib::database::domains::get_meta;` (`ErrorCode` is already imported):

```rust
// ---------------------------------------------------------------------------
// Backup commands (Task 5)
// ---------------------------------------------------------------------------

/// Read one `app_meta` key through the manager's own data job.
async fn meta_at(manager: &Arc<DatabaseManager>, key: &str) -> Option<String> {
    let key = key.to_string();
    manager
        .data_job(move |state| get_meta(state.connection()?, &key))
        .await
        .unwrap()
}

#[tokio::test]
async fn backup_create_publishes_a_backup_and_records_the_timestamp() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let _ = manager.initialize().await.unwrap();
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();

    let path = backup_create(state).await.unwrap();

    assert!(std::path::Path::new(&path).exists(), "no file at {path}");
    let name = std::path::Path::new(&path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(
        name.starts_with("notchy-backup-v"),
        "routine backups use the published name: {name}"
    );
    // The health card reads this key, so a published backup must set it.
    assert!(
        meta_at(&manager, "last_backup_at").await.is_some(),
        "last_backup_at was not recorded"
    );
}

#[tokio::test]
async fn backup_create_leaves_the_timestamp_alone_when_publication_fails() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let _ = manager.initialize().await.unwrap();
    // A file where the backup directory belongs makes publication fail: the
    // directory cannot be created.
    let backup_dir = manager.backup_dir();
    let _ = std::fs::remove_dir_all(&backup_dir);
    std::fs::write(&backup_dir, b"not a directory").unwrap();
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();

    let error = backup_create(state).await.unwrap_err();

    assert_eq!(error.code, ErrorCode::DatabaseInvalid);
    assert!(
        meta_at(&manager, "last_backup_at").await.is_none(),
        "a failed backup must not claim success"
    );
}

#[tokio::test]
async fn backup_export_sqlite_writes_the_named_file() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let _ = manager.initialize().await.unwrap();
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let target = scratch_root("cmd-export").join("chosen.sqlite");
    std::fs::create_dir_all(target.parent().unwrap()).unwrap();

    backup_export_sqlite(target.to_string_lossy().into_owned(), state)
        .await
        .unwrap();

    assert!(target.exists());
}

#[tokio::test]
async fn backup_export_csv_writes_the_table_set() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let _ = manager.initialize().await.unwrap();
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let dir = scratch_root("cmd-export-csv");

    let written = backup_export_csv(dir.to_string_lossy().into_owned(), state)
        .await
        .unwrap();

    assert_eq!(written.len(), 7);
    assert!(dir.join("accounts.csv").exists());
}
```

`manager.data_job` is `pub` and already used from this test file (see `data_jobs_run_once_ready`), and `manager.backup_dir()` is `pub`. `manager.paths()` is `pub(crate)` and must not be called from a test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test command_guards backup`
Expected: FAIL to compile — `cannot find function 'backup_create' in this scope`.

- [ ] **Step 3: Add the manager method**

In `src-tauri/src/database/executor.rs`, beside `backup_dir()`:

```rust
    /// Publish a routine backup of the live database and record the timestamp.
    ///
    /// The publication runs inside the data job so no write interleaves with the
    /// online copy. `last_backup_at` is written only after publication succeeds:
    /// a failed backup leaves the last known-good timestamp intact, which is the
    /// invariant the pre-port JS path documented.
    pub async fn create_routine_backup(&self) -> DbResult<String> {
        let db_path = self.paths().db_path.clone();
        let backup_dir = self.backup_dir();
        self.data_job(move |state| {
            let token = crate::database::backup::publish_backup(
                &db_path,
                &backup_dir,
                crate::database::backup::BackupFailurePoint::None,
            )?;
            let path = token.path().to_string_lossy().into_owned();
            crate::database::domains::set_meta(
                state.connection()?,
                "last_backup_at",
                &crate::database::migrations::now_iso_utc(),
            )?;
            Ok(path)
        })
        .await
    }
```

`BackupToken::path()` is the accessor the startup path already uses (`startup.rs:280`).

- [ ] **Step 4: Add the three commands**

In `src-tauri/src/database/commands.rs`, after the report commands:

```rust
// ===========================================================================
// Backup commands
// ===========================================================================

/// Publish a routine backup into the app's backup directory and return its path.
#[tauri::command]
pub async fn backup_create(manager: State<'_, Arc<DatabaseManager>>) -> Result<String, DbError> {
    manager.create_routine_backup().await
}

/// Write a validated copy of the live database to an exact user-chosen path.
#[tauri::command]
pub async fn backup_export_sqlite(
    target_path: String,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<(), DbError> {
    let db_path = manager.paths().db_path.clone();
    manager
        .data_job(move |_state| {
            crate::database::backup::export_backup_to(&db_path, std::path::Path::new(&target_path))?;
            Ok(())
        })
        .await
}

/// Write one CSV per exported table into a user-chosen directory.
#[tauri::command]
pub async fn backup_export_csv(
    dir: String,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<String>, DbError> {
    manager
        .data_job(move |state| {
            crate::database::domains::export::export_table_set_csv(
                state.connection()?,
                std::path::Path::new(&dir),
            )
        })
        .await
}
```

- [ ] **Step 5: Register the commands and run the tests**

In `src-tauri/src/lib.rs`, add the three names to the `generate_handler![...]` list (after the report commands) and to the `use` block that imports them:

```rust
            backup_create,
            backup_export_sqlite,
            backup_export_csv,
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — the four new tests plus every existing guard test.

- [ ] **Step 6: Verify the boundary test and contracts are still green**

Run: `pnpm test -- native-boundary`
Expected: PASS — the new commands are registered but not yet invoked from production code, so the inverse check has nothing new to reject.

Run: `pnpm check:db-contracts`
Expected: `bindings are current` — the three commands return primitives, so the generated contracts do not change.

- [ ] **Step 7: Lint and commit**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

```bash
git add src-tauri/src/database/executor.rs src-tauri/src/database/commands.rs src-tauri/src/lib.rs src-tauri/tests/command_guards.rs
git commit -m "$(cat <<'EOF'
feat(backup): add create and export commands to the native surface

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The `BackupOps` port with both adapters

Adding `backup` to `AppDatabase` breaks compilation for any adapter that lacks it, so the interface, both adapters, and both wirings land in this one commit. The native bridges are production `invoke()` sites, so the boundary test's fixtures and sweep rows must land here too.

**Files:**
- Modify: `src/lib/db/client.ts` (add `BackupOps`; add `readonly backup: BackupOps` to `AppDatabase`)
- Create: `src/lib/db/browser/backup.ts` (`BrowserBackupOps`)
- Create: `src/lib/db/native/backup.ts` (`NativeBackupOps`)
- Modify: `src/lib/db/browser/client.ts` (declare + construct `backup`)
- Modify: `src/lib/db/native/client.ts` (wire `backup`)
- Test: `src/tests/unit/backup.test.ts` (the browser contract), `src/tests/unit/native-boundary.test.ts` (fixtures + rows)

**Interfaces:**
- Consumes: `DatabaseService`; `createBackup` (`src/lib/backup/index.ts:13`) and `exportCsv` (`:105`, returns `Map<string, string>` and writes nothing — the adapter owns writing); `getDatabasePaths()` and `ensureDirectory` from `$lib/db`; `setMeta(db, key, value)` from the browser meta repo; the three commands from Task 5.
- Produces, for Task 7:

```ts
export interface BackupOps {
	create(): Promise<string>;
	exportSqlite(targetPath: string): Promise<void>;
	exportCsv(dir: string): Promise<string[]>;
}
```

- [ ] **Step 1: Write the failing browser-contract tests**

Append to `src/tests/unit/backup.test.ts`. Add `mkdirSync` and `writeFileSync` to its `node:fs` import, and the adapter to the imports:

```ts
import { BrowserBackupOps, type BrowserBackupOptions } from '$lib/db/browser/backup';
```

```ts
describe('BackupOps contract (browser adapter)', () => {
	let dir: string;

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), 'notchy-backupops-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function ops(extra: Partial<BrowserBackupOptions> = {}): BrowserBackupOps {
		return new BrowserBackupOps(db, {
			backupDir: dir,
			ensureDirectory: async () => {},
			writeFile: async (path, content) => writeFileSync(path, content),
			...extra
		});
	}

	it('create publishes a backup into the routine directory', async () => {
		const path = await ops().create();

		expect(path.startsWith(dir)).toBe(true);
		expect(existsSync(path)).toBe(true);
	});

	it('create records last_backup_at once the file exists', async () => {
		const path = await ops().create();

		expect(existsSync(path)).toBe(true);
		const rows = await db.query<{ value: string }>(
			`SELECT value FROM app_meta WHERE key = 'last_backup_at'`
		);
		expect(rows).toHaveLength(1);
	});

	it('create reports a failure and leaves the marker unset when the file cannot be written', async () => {
		const missing = join(dir, 'missing', 'deeper');

		await expect(ops({ backupDir: missing }).create()).rejects.toThrow();

		const rows = await db.query(
			`SELECT value FROM app_meta WHERE key = 'last_backup_at'`
		);
		expect(rows).toHaveLength(0);
	});

	it('exportSqlite writes a readable copy at the exact path', async () => {
		const target = join(dir, 'chosen.sqlite');

		await ops().exportSqlite(target);

		expect(existsSync(target)).toBe(true);
		const copy = new BetterSqlite3(target, { readonly: true });
		try {
			expect(copy.prepare('SELECT COUNT(*) AS c FROM app_meta').get()).toEqual({
				c: expect.any(Number)
			});
		} finally {
			copy.close();
		}
	});

	it('exportCsv writes one file per table and returns the paths', async () => {
		const csvDir = join(dir, 'csv');
		mkdirSync(csvDir, { recursive: true });

		const written = await ops().exportCsv(csvDir);

		expect(written).toHaveLength(7);
		expect(existsSync(join(csvDir, 'accounts.csv'))).toBe(true);
	});

	it('exportCsv produces a file for a table with no rows', async () => {
		const csvDir = join(dir, 'csv-empty');
		mkdirSync(csvDir, { recursive: true });

		await ops().exportCsv(csvDir);

		expect(existsSync(join(csvDir, 'goals.csv'))).toBe(true);
	});
});
```

`BetterSqlite3`, `db` (built in the file's existing `beforeEach`), `mkdtempSync`, `rmSync`, `existsSync`, `join`, `tmpdir` are already imported at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- backup.test`
Expected: FAIL — `Cannot find module '$lib/db/browser/backup'`.

- [ ] **Step 3: Declare the port**

In `src/lib/db/client.ts`, add after `ReportOps`:

```ts
/**
 * Backup and export operations. Both adapters publish through one crash-safe
 * path: the browser adapter over sql.js, the native adapter over Rust's
 * publication protocol. No op exposes a query handle — a caller gets a path or
 * an error, never SQL.
 */
export interface BackupOps {
	/**
	 * Publish a routine backup into the app's routine backup directory and
	 * resolve to its canonical path. Records `last_backup_at` only if the
	 * publication succeeded.
	 */
	create(): Promise<string>;
	/**
	 * Write a validated copy of the live database to exactly `targetPath`,
	 * replacing any existing file.
	 */
	exportSqlite(targetPath: string): Promise<void>;
	/**
	 * Write one CSV per exported table into `dir`, replacing existing files.
	 * Resolves to the written paths — one per table, including a table with no
	 * rows.
	 */
	exportCsv(dir: string): Promise<string[]>;
}
```

and in `AppDatabase`, after `readonly reports: ReportOps;`:

```ts
	readonly backup: BackupOps;
```

- [ ] **Step 4: Implement the browser adapter**

Create `src/lib/db/browser/backup.ts`:

```ts
/**
 * Browser `BackupOps` — sql.js in Vitest and Playwright.
 *
 * Wraps the existing backup helpers so the web build keeps its current
 * behaviour: `VACUUM INTO` for database copies and the JS table dump for CSV.
 * Discovery is Rust-only (`discoverRestorePoints` returns `[]` in the browser),
 * so a browser-side filename has no cross-adapter contract to honour — the
 * timestamp filenames stay on this side on purpose.
 *
 * The seams exist because the Tauri plugins are absent in the browser: without
 * them a test cannot aim a backup at a real directory or capture the CSV writes.
 * `..` is imported lazily because `src/lib/db/index.ts` constructs this client,
 * so a static import would close a module cycle.
 *
 * One difference from the pre-port page: this writes a file for every table,
 * including an empty one, because the port promises one file per table. The JS
 * dump returns an empty string for a table with no rows, so such a file is
 * empty rather than header-only — only the native path can cheaply emit
 * headers, so the content of an empty table's file is not part of the contract.
 */
import type { DatabaseService } from './service';
import type { BackupOps } from '../client';
import { createBackup, exportCsv } from '$lib/backup';
import { setMeta } from './repos/meta';

export interface BrowserBackupOptions {
	/** Routine backup directory. Defaults to `getDatabasePaths().routineBackupDir`. */
	backupDir?: string;
	/** Directory-creation seam. Defaults to the platform `ensureDirectory`. */
	ensureDirectory?: (path: string) => Promise<void>;
	/** File-write seam. Defaults to the Tauri FS plugin's `writeTextFile`. */
	writeFile?: (path: string, content: string) => Promise<void>;
}

export class BrowserBackupOps implements BackupOps {
	constructor(
		private readonly db: DatabaseService,
		private readonly options: BrowserBackupOptions = {}
	) {}

	async create(): Promise<string> {
		const dir =
			this.options.backupDir ?? (await import('..')).getDatabasePaths().routineBackupDir;
		await this.ensure(dir);
		const path = await createBackup(this.db, dir);
		// Recorded only after the file exists, so a failure leaves the last
		// known-good timestamp intact.
		await setMeta(this.db, 'last_backup_at', new Date().toISOString());
		return path;
	}

	async exportSqlite(targetPath: string): Promise<void> {
		await this.db.execute(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
	}

	async exportCsv(dir: string): Promise<string[]> {
		await this.ensure(dir);
		const csvMap = await exportCsv(this.db);
		const written: string[] = [];
		for (const [table, content] of csvMap) {
			const path = `${dir}/${table}.csv`;
			await this.write(path, content);
			written.push(path);
		}
		return written;
	}

	private async ensure(dir: string): Promise<void> {
		if (this.options.ensureDirectory) return this.options.ensureDirectory(dir);
		const { ensureDirectory } = await import('..');
		return ensureDirectory(dir);
	}

	private async write(path: string, content: string): Promise<void> {
		if (this.options.writeFile) return this.options.writeFile(path, content);
		const { writeTextFile } = await import('@tauri-apps/plugin-fs');
		await writeTextFile(path, content);
	}
}
```

Check `src/lib/db/browser/service.ts` for the service's real module path before writing the first import — if the class lives elsewhere (for example alongside `client.ts`), import from there; the neighbouring adapter files show the correct relative path.

- [ ] **Step 5: Implement the native adapter**

Create `src/lib/db/native/backup.ts`:

```ts
/**
 * Native `BackupOps` — the production Tauri adapter.
 *
 * Thin `invoke()` bridges: Rust owns the publication protocol, the manifest
 * validation, and the CSV escaping. No raw SQL crosses this seam.
 */
import { invoke } from '@tauri-apps/api/core';
import type { BackupOps } from '../client';
import { isTauri } from '..';

function requireNative(): void {
	if (!isTauri()) {
		throw new Error('backup operations are only available in the desktop app');
	}
}

export class NativeBackupOps implements BackupOps {
	async create(): Promise<string> {
		requireNative();
		return invoke<string>('backup_create');
	}

	async exportSqlite(targetPath: string): Promise<void> {
		requireNative();
		return invoke<void>('backup_export_sqlite', { targetPath });
	}

	async exportCsv(dir: string): Promise<string[]> {
		requireNative();
		return invoke<string[]>('backup_export_csv', { dir });
	}
}
```

Match the `isTauri` import and the native-unavailable error shape to the sibling `src/lib/db/native/recovery.ts`, which is the established pattern.

- [ ] **Step 6: Wire both clients**

In `src/lib/db/browser/client.ts`, import the adapter and the `BackupOps` type, declare the field beside the others (`readonly backup: BackupOps;`) and assign it in the constructor next to `this.reports = new BrowserReportOps(db);`:

```ts
		this.backup = new BrowserBackupOps(db);
```

In `src/lib/db/native/client.ts`, import the adapter and the type, then declare it beside the other ops fields (that file initializes inline rather than in a constructor):

```ts
	readonly backup: BackupOps = new NativeBackupOps();
```

- [ ] **Step 7: Run the browser-contract tests to verify they pass**

Run: `pnpm test -- backup.test`
Expected: PASS.

- [ ] **Step 8: Add the boundary fixtures and sweep rows**

In `src/tests/unit/native-boundary.test.ts`, add to the `FIXTURES` map:

```ts
		// Backup
		backup_create: '/data/backups/notchy-backup-v6-0.2.1-01M3CGSB1ASS5VDMKWMHXE4HVJ.sqlite',
		backup_export_sqlite: null,
		backup_export_csv: ['/data/export/accounts.csv'],
```

and to the `rows` array:

```ts
		// Backup
		{ label: 'backup.create', run: () => client.backup.create(), command: 'backup_create' },
		{
			label: 'backup.exportSqlite',
			run: () => client.backup.exportSqlite('/tmp/x.sqlite'),
			command: 'backup_export_sqlite'
		},
		{
			label: 'backup.exportCsv',
			run: () => client.backup.exportCsv('/tmp/export'),
			command: 'backup_export_csv'
		},
```

- [ ] **Step 9: Run the boundary test and the full suite**

Run: `pnpm test -- native-boundary`
Expected: PASS — each row's camelCase arg keys match the parsed Rust signatures (`[]`, `['targetPath']`, `['dir']`).

Run: `pnpm check && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/client.ts src/lib/db/browser/backup.ts src/lib/db/native/backup.ts src/lib/db/browser/client.ts src/lib/db/native/client.ts src/tests/unit/backup.test.ts src/tests/unit/native-boundary.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add a BackupOps port with browser and native adapters

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Move the page onto the port

The commit that removes the escape hatch. Health stops taking a `DatabaseService`, the three actions call `db.backup`, `getRawDb` is deleted, and a source-level test pins the class of regression.

**Files:**
- Modify: `src/lib/backup/health.ts` (`getBackupHealth` signature; retire `createManualBackup` and `ManualBackupOptions`)
- Modify: `src/routes/settings/backup/+page.svelte` (delete `getRawDb`; four call sites)
- Modify: `src/tests/unit/backup-health.test.ts` (re-point at `db.meta`; delete the `createManualBackup` block)
- Create: `src/tests/unit/no-raw-db-handle.test.ts`
- Test: a page test under `src/tests/unit/components/`

**Interfaces:**
- Consumes: `BackupOps` and `MetaOps` from the port; `BackupHealth` / `BackupHealthOptions` shapes unchanged (fields `appVersion`, `schemaVersion`, `databasePath`, `lastRoutineBackupAt`, `lastUpgradeBackupPath`, `lastUpgradeFromSchema`, `warning`).
- Produces: `getBackupHealth(meta: MetaOps, options: BackupHealthOptions): Promise<BackupHealth>`.

The five keys read stay exactly the same — `schema_version`, `last_backup_at`, `last_upgrade_backup_path`, `last_migrated_from_schema`, `backup_warning` — and financial tables are still never touched.

- [ ] **Step 1: Write the failing tests**

In `src/tests/unit/backup-health.test.ts`: change the import on line 10 to `import { getBackupHealth } from '$lib/backup/health';`, delete the whole `describe('createManualBackup', …)` block (lines 74-114 — its two behaviours are covered by the `BackupOps` contract tests in Task 6), change **every** `getBackupHealth(db, OPTS)` call to `getBackupHealth(db.meta, OPTS)`, and add:

```ts
describe('getBackupHealth reads only app_meta', () => {
	it('does not require a raw database handle', async () => {
		const meta = { get: async (key: string) => (key === 'schema_version' ? '6' : null) };

		const health = await getBackupHealth(meta as never, OPTS);

		expect(health.schemaVersion).toBe(6);
		expect(health.lastRoutineBackupAt).toBeNull();
	});
});
```

Create `src/tests/unit/no-raw-db-handle.test.ts`:

```ts
/**
 * Guards the class, not the instance: a page must reach the database through
 * the domain port. The escape hatch (`db.raw`) exists only on the browser
 * client, so any page that uses it works in Playwright and dies on the desktop
 * build — which is exactly how Settings -> Backup & Data shipped broken.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES = fileURLToPath(new URL('../../routes', import.meta.url));

// The handle shape, not the substring: `row.raw` (CSV row data) is legitimate.
const FORBIDDEN = [/(db|database)\s+as\s+unknown\s+as\s*\{\s*raw\s*:/, /\bgetRawDb\b/];

function filesUnder(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
}

describe('no route reads a raw database handle', () => {
	it('finds no escape-hatch usage under src/routes', () => {
		const offenders = filesUnder(ROUTES).flatMap((path) => {
			const source = readFileSync(path, 'utf-8');
			return FORBIDDEN.filter((pattern) => pattern.test(source)).map(
				(pattern) => `${path}: ${pattern}`
			);
		});

		expect(offenders).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- backup-health no-raw-db-handle`
Expected: FAIL — `no route reads a raw database handle` reports `src/routes/settings/backup/+page.svelte` for both patterns, and the health tests fail to type-check against the old signature.

- [ ] **Step 3: Change the health signature and retire `createManualBackup`**

In `src/lib/backup/health.ts`, take the port's meta ops, delete `createManualBackup` and `ManualBackupOptions` (their steps are now `BackupOps.create()`), and drop the now-unused imports (`DatabaseService`, `getMeta`, `setMeta`, `createBackup`, `getDatabasePaths`, `ensureDirectory`):

```ts
import type { MetaOps } from '../db/client';

export async function getBackupHealth(
	meta: MetaOps,
	options: BackupHealthOptions
): Promise<BackupHealth> {
	const [
		schemaVersion,
		lastRoutineBackupAt,
		lastUpgradeBackupPath,
		lastMigratedFromSchema,
		warning
	] = await Promise.all([
		meta.get('schema_version'),
		meta.get('last_backup_at'),
		meta.get('last_upgrade_backup_path'),
		meta.get('last_migrated_from_schema'),
		meta.get('backup_warning')
	]);

	return {
		appVersion: options.appVersion,
		schemaVersion: parseSchemaVersion(schemaVersion),
		databasePath: options.databasePath,
		lastRoutineBackupAt,
		lastUpgradeBackupPath,
		lastUpgradeFromSchema:
			lastMigratedFromSchema === null ? null : Number(lastMigratedFromSchema),
		warning
	};
}
```

`parseSchemaVersion` stays exactly as it is.

- [ ] **Step 4: Move the page onto the port**

In `src/routes/settings/backup/+page.svelte`: delete `getRawDb` and the `DatabaseService` import, and drop `exportCsv` and `writeTextFile` from the imports. Then:

```ts
	async function loadHealth() {
		try {
			const [appVersion, paths] = await Promise.all([
				getInstalledAppVersion(),
				getDatabasePaths()
			]);
			upgradeBackupDir = paths.upgradeBackupDir;
			health = await getBackupHealth(getDb().meta, {
				appVersion,
				databasePath: paths.databasePath,
				upgradeBackupDir: paths.upgradeBackupDir
			});
			healthError = null;
		} catch (e) {
			healthError = mapError(e);
		}
	}

	async function createBackupNow() {
		try {
			busy = true;
			await getDb().backup.create();
			await loadHealth();
			toast.show(m.settings_backup_toast_created());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}

	async function exportSqlite() {
		try {
			busy = true;
			const path = await save({
				defaultPath: `notchy-${new Date().toISOString().split('T')[0]}.sqlite`,
				filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
			});
			if (!path) return;
			await getDb().backup.exportSqlite(path);
			toast.show(m.settings_backup_toast_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}
```

Leave `openUpgradeFolder`, `importDb`, and the rest of the page untouched. For `exportCsvFiles`, keep the dialog and the toasts and replace only the write:

```ts
	async function exportCsvFiles() {
		try {
			busy = true;
			const dir = await open({ directory: true });
			if (!dir) return;
			await getDb().backup.exportCsv(dir);
			toast.show(m.settings_backup_toast_csv_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- backup-health no-raw-db-handle backup`
Expected: PASS.

- [ ] **Step 6: Add the page test**

Follow the pattern of an existing route-page test under `src/tests/unit/components/` — read one that renders a page and seeds `getDb`, and copy its mocking approach. Assert only the routing, with a fake `AppDatabase` whose `backup` ops record their calls: health renders the version and schema (`db.meta` returns the five keys), "Create backup now" calls `backup.create`, and the two export buttons call `backup.exportSqlite` / `backup.exportCsv`.

- [ ] **Step 7: Run the full gate**

Run: `pnpm check && pnpm test && pnpm test:e2e`
Expected: PASS — the E2E backup/restore suite drives the browser client through the same `BackupOps` the page now uses.

- [ ] **Step 8: Commit**

```bash
git add src/lib/backup/health.ts src/routes/settings/backup/+page.svelte src/tests/unit/backup-health.test.ts src/tests/unit/no-raw-db-handle.test.ts src/tests/unit/components
git commit -m "$(cat <<'EOF'
fix(settings): move the backup page onto the domain port

The page read the database through `db.raw`, a handle only the browser client
exposes, so on the desktop build the health card errored, "Create backup now"
wrote nothing, and both exports threw. Health now reads app_meta through the
port's meta ops, and the three actions go through BackupOps.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full gate, desktop proof, and closing the trigger

This is the task that proves the fix on the platform where the defect shipped, and closes the plan that found it.

**Files:**
- Modify: `specs/plans/2026-08-17-rust-database-integrity-boundary.md` (Task 15 steps 6-8)
- Modify: `specs/notes/2026-08-17-v0.2.0.md` (record the re-verification)
- Modify: `specs/2026-07-27-desktop-release-smoke-checklist.md` (the two rows this unblocks)
- Modify: `specs/STATUS.md` (regenerated)

**Interfaces:**
- Consumes: everything above.
- Produces: a `partial` → `pass` GUI result for manual backup and the backup/restore round-trip, or an honest `partial` with the new failure recorded.

- [ ] **Step 1: Run every automated gate**

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm test:roadmap
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: all pass. `pnpm test:roadmap` must print this plan as in-progress with every box flipped and no `⚠ stale` — a stale reading means a commit subject did not match a step's heredoc, so fix the step text, not the commit.

- [ ] **Step 2: Smoke the fix in the real app**

Run: `pnpm tauri dev`
Then, in the app: open Settings → Backup & Data and confirm the card shows the app version, schema version, database path, and last-backup rows (no error text); press **Create backup now** and confirm a toast plus a new `notchy-backup-v6-*.sqlite` in the routine backup folder; press **Open backup folder** and confirm the file is there.

- [ ] **Step 3: Prove it on an installed package**

Follow `specs/plans/2026-08-17-rust-database-integrity-boundary.md` Task 15 Steps 6-7. The two GUI cases this unblocks are **Manual backup** (was `fail`) and **Backup/restore round-trip** (was `blocked`). Record the outcome honestly: a skipped or failed case leaves the result `partial`. If the package on the machine predates these commits, cut a new one first — the earlier session's evidence is tied to a specific checksum.

- [ ] **Step 4: Record the evidence and close the boxes**

Append the re-verification to `specs/notes/2026-08-17-v0.2.0.md` (package version, checksum, the two case results, and any case still not drivable via WebKitWebDriver). Update the two rows in `specs/2026-07-27-desktop-release-smoke-checklist.md`. Then flip Task 15's steps 6-8 to `[x]` in the boundary plan **and** this plan's boxes, and refresh the generated roadmap with `pnpm test:roadmap`.

Step 6 (the `sudo apt install` approval) and Step 7's literal package-manager upgrade sequence may still be out of reach in a given session; if so, say so in the note and leave those boxes open rather than claiming a pass that did not happen.

- [ ] **Step 5: Commit**

```bash
git add specs/plans/2026-08-17-rust-database-integrity-boundary.md specs/notes/2026-08-17-v0.2.0.md specs/2026-07-27-desktop-release-smoke-checklist.md specs/STATUS.md
git commit -m "$(cat <<'EOF'
docs: verify the backup page on a real package and close the trigger

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

**Spec coverage.** §2.1 `BackupOps` → Tasks 6-7. §2.2 health over `MetaOps`, `createManualBackup` retired → Tasks 6 (port) and 7 (signature + its test block deleted). §3 browser adapter → Task 6. §4.1 `backup_create` → Task 5. §4.2 `export_backup_to` → Tasks 1 and 5. §4.3 seven-table CSV → Tasks 3 and 5. §4.4 legacy names → Task 2. §5 failure behaviour → Tasks 1, 2, 3, 5, and Task 4 removes the dead contracts §2.2 implied. §6 verification → every task's test steps plus Task 8. §7 out of scope → untouched by design: no task wires `runAutoBackup` or `retention_deletions`, and no task removes the browser client's `raw` getter.

**Corrections found while checking the plan against the code** (each would have cost an implementer a debugging cycle):

- `exportCsv` (`src/lib/backup/index.ts:105`) takes no directory and writes no files — it returns a `Map<string, string>`. The old *page* wrote the files. So `BrowserBackupOps.exportCsv` owns the writing and needs a `writeFile` seam, and the port's contract is stated accordingly.
- The JS dump returns `''` for a table with no rows and the page skipped writing it, so a naive port would have produced fewer than seven files. Task 6 makes the adapter write every table; Task 3's Rust writer emits a header line for an empty table. The empty table's *content* is therefore not part of the contract, and the plan says so rather than claiming byte-for-byte parity.
- `publish_backup`'s "never overwrite a verified backup" check (`backup.rs:181`) would have rejected every export onto an existing path, which is the ordinary case. Task 1 makes the check conditional on a derived name.
- `discover_verified_backups` validates the manifest *before* opening the file today; a legacy name has no schema, so the order had to invert. Stated in Task 2 Step 4.
- A legacy-name shape check that tests only "digit or dash" would reject the `T` separator. Task 2's loop skips indices 10 and 23 explicitly.
- `data_job` requires a `Ready` boundary (`ensure_ready` → `DatabaseUpdateRequired`), so every Task 5 test initializes first.
- `manager.paths()` is `pub(crate)`, so Task 5's tests read `app_meta` through `manager.data_job` (which is `pub` and already used from that test file) rather than through the paths.
- A failed publication reports `DatabaseInvalid` — `publish_backup` maps its `create_dir_private` failure that way (`backup.rs:149`), not `BackupUnavailable`.
- `src/tests/unit/backup-health.test.ts` carries a `createManualBackup` describe block (lines 74-114) that must be deleted with the function; Task 6's contract tests cover both of its behaviours.
- `ulid` is a normal dependency and integration tests link those (other suites import `rusqlite` directly), so Task 2's tests derive a published ULID with `Ulid::from_datetime` instead of hardcoding one whose decoded timestamp nobody can verify by eye.
- `make_tx` does not set a payee, so Task 3's injection test writes the two escaped cells with an `UPDATE` after the helper returns.

**Known gaps, stated rather than hidden.**

- §9's file table lists `src/lib/backup/index.ts` as unchanged; `createBackup` and `exportCsv` stay where they are because the browser adapter (Task 6) is now their only caller through the port. `runAutoBackup` keeps its raw `db.query` call and its zero production callers — out of scope per §7, so the dead-code smell is deliberate follow-up work, not an oversight.
- §9 lists `src/lib/db/index.ts` as the place the browser adapter learns its seams; Task 6 gives it those seams through `BrowserBackupOptions` inside `BrowserDatabaseClient` instead, since the client already constructs every other op with the live `DatabaseService` and a second construction site would need the same instance.
- Two steps name a source file to read rather than reproducing it: the bindings-generator call in Task 4 Step 1 (the existing tests in `contracts.rs` are the reference) and the page-test scaffold in Task 7 Step 6 (an existing route-page test is the reference). Both are one-line lookups in files these tasks already touch; everything else in this plan is written out.

**Ordering constraints worth repeating.** Task 6 cannot be split: adding `backup` to `AppDatabase` breaks whichever adapter lacks it, and its native bridges create the `invoke()` sites the boundary test requires fixtures for. Task 7 likewise cannot be split: the `.raw` guard test can only pass once all four call sites are ported.
