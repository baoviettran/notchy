//! Durable backup publication, verified discovery, and retention (Task 4).
//!
//! `publish_backup` copies the source database through SQLite's online backup
//! API into a uniquely named `.tmp` file in the destination directory, validates
//! the complete source-version manifest plus integrity and foreign keys,
//! `fsync`s the file, atomically renames it to its final name, and `fsync`s the
//! directory. Only then is the backup durable and eligible for retention.
//!
//! `discover_verified_backups` revalidates every candidate before it can
//! displace another recovery point — filename parsing is discovery metadata,
//! never proof. `retention_deletions` protects the newly published backup and
//! the newest two verified records per source schema.
//! `cleanup_interrupted_publications` removes unpublished `.tmp` files left by
//! a killed process without deleting verified backups.
//!
//! Backup filenames use the last successfully recorded source application
//! version (`app_meta.last_successful_app_version`), never the currently
//! running target binary version. No raw SQLite errors, SQL parameters, rows,
//! payees, descriptions, or monetary values ever leave this module.

use std::cell::Cell;
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::backup::Backup;
use rusqlite::Connection;
use ulid::Ulid;

use crate::database::connection::{create_dir_private, open_live_at, open_read_only_at};
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::manifest::{manifest_for, validate_manifest};
use crate::database::types::{BackupSummary, BackupToken, OperationId};

/// Prefix of an in-progress publication's temporary file, inside the
/// destination directory.
const TEMP_PREFIX: &str = ".notchy-backup-";
const TEMP_SUFFIX: &str = ".tmp";

/// The source application version recorded when the database has no
/// `last_successful_app_version` row yet (pre-metadata native backups).
const UNKNOWN_APP_VERSION: &str = "unknown";

/// The published-backup filename prefix. The full final name is
/// `notchy-backup-v<schema>-<app-version>-<ULID>.sqlite`.
const FINAL_PREFIX: &str = "notchy-backup-v";
const FINAL_SUFFIX: &str = ".sqlite";

/// Legacy routine-backup filename prefix, written by the pre-port JS path:
/// `notchy-backup-<ISO timestamp>.sqlite`.
const LEGACY_PREFIX: &str = "notchy-backup-";

/// The subdirectory of the backup directory that pre-upgrade backups are
/// published into. Discovery scans it alongside the backup directory itself, so
/// an upgrade backup stays visible to retention and to restore.
pub const UPGRADES_DIR: &str = "upgrades";

// ---------------------------------------------------------------------------
// Failure-point injection (mirrors the migration FailurePoint pattern)
// ---------------------------------------------------------------------------

/// Fault-injection points in the publication sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupFailurePoint {
    /// Run without injected failure.
    None,
    /// Fail (or, in a kill test, hang) after the online copy writes the temp
    /// file.
    AfterCopy,
    /// Fail after the copy passes manifest validation.
    AfterValidate,
    /// Fail after the temp file is `fsync`ed.
    AfterFileSync,
    /// Fail after the temp file is renamed to the final name.
    AfterRename,
    /// Fail after the destination directory is `fsync`ed.
    AfterDirSync,
}

impl BackupFailurePoint {
    /// Stable snake_case name, matching the strings used by the tests.
    pub fn name(self) -> &'static str {
        match self {
            BackupFailurePoint::None => "none",
            BackupFailurePoint::AfterCopy => "after_copy",
            BackupFailurePoint::AfterValidate => "after_validate",
            BackupFailurePoint::AfterFileSync => "after_file_sync",
            BackupFailurePoint::AfterRename => "after_rename",
            BackupFailurePoint::AfterDirSync => "after_dir_sync",
        }
    }

    /// Resolve a snake_case name to a failpoint, or `None` for unknown names.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "after_copy" => Some(BackupFailurePoint::AfterCopy),
            "after_validate" => Some(BackupFailurePoint::AfterValidate),
            "after_file_sync" => Some(BackupFailurePoint::AfterFileSync),
            "after_rename" => Some(BackupFailurePoint::AfterRename),
            "after_dir_sync" => Some(BackupFailurePoint::AfterDirSync),
            _ => None,
        }
    }
}

thread_local! {
    static FAILPOINT: Cell<Option<BackupFailurePoint>> = const { Cell::new(None) };
}

fn set_failpoint(failpoint: BackupFailurePoint) {
    FAILPOINT.with(|slot| slot.set(Some(failpoint)));
}

/// Fire a failpoint: when armed, either hang (for the subprocess kill test,
/// gated behind `NOTCHY_BACKUP_HANG_AT`) or return `BackupUnavailable`.
///
/// The hang branch is a test-only hook used by `backup_probe`: it lets the
/// parent test SIGKILL the process mid-publication so the orphaned `.tmp` file
/// survives for restart-cleanup verification. In normal runs the variable is
/// never set, so the failpoint always errors.
fn failpoint_stage(stage: BackupFailurePoint) -> DbResult<()> {
    let target = FAILPOINT.with(Cell::get);
    if target == Some(stage) {
        if std::env::var("NOTCHY_BACKUP_HANG_AT").as_deref() == Ok(stage.name()) {
            loop {
                std::thread::sleep(Duration::from_secs(3600));
            }
        }
        return Err(DbError::new(ErrorCode::BackupUnavailable));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

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

/// Publish a verified, durable backup whose final filename is chosen by the
/// caller.
///
/// `name: None` derives the published-backup name from the source's own schema
/// and app version; `Some(name)` is used verbatim. Either way the copy is staged
/// in a temp file beside the target, validated, `fsync`ed, and renamed
/// atomically.
///
/// The directory policy follows the naming: a derived name means a Notchy-owned
/// backup directory, created `0700`; a caller-named target means a directory the
/// user chose, which is created if missing and left with whatever mode the user
/// set.
fn publish_backup_named(
    source_path: &Path,
    backup_dir: &Path,
    name: Option<&str>,
    failpoint: BackupFailurePoint,
) -> DbResult<BackupToken> {
    set_failpoint(failpoint);
    // `name` is moved into the naming block below, so read this here.
    let caller_named = name.is_some();
    // A Notchy-owned backup directory is created 0700 because the app owns its
    // policy. A caller-named target sits wherever the user chose, so the mode is
    // theirs to set — chmod'ing their directory would be a silent, persistent
    // permission change outside the app's storage, and on a directory the user
    // can write but not chmod (a shared folder, vfat, SMB) it would fail the
    // export outright. Either way a parent that is a file fails here.
    let prepared = if caller_named {
        std::fs::create_dir_all(backup_dir)
    } else {
        create_dir_private(backup_dir)
    };
    prepared.map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

    // Validate the source before copying: only known-good data is published.
    let (schema_version, app_version) = {
        let source = open_read_only_at(source_path)?;
        let meta = read_source_meta(&source)?;
        validate_manifest(&source, meta.0)?;
        meta
    };

    let temp_path = backup_dir.join(format!(
        "{TEMP_PREFIX}{}{TEMP_SUFFIX}",
        OperationId::generate().as_str()
    ));

    let mut final_path: Option<PathBuf> = None;
    // Whether the final target already existed when this publication renamed
    // over it. A derived name can never pre-exist — the guard below refuses it —
    // but a caller-named export replaces the user's own file, and deleting the
    // target after a post-rename failure would leave the user with nothing
    // instead of the replacement they agreed to.
    let mut target_pre_existed = false;
    let result = (|| -> DbResult<BackupToken> {
        copy_online(source_path, &temp_path)?;
        failpoint_stage(BackupFailurePoint::AfterCopy)?;

        let copy = open_read_only_at(&temp_path)?;
        validate_manifest(&copy, schema_version)?;
        drop(copy);
        failpoint_stage(BackupFailurePoint::AfterValidate)?;

        sync_file(&temp_path)?;
        failpoint_stage(BackupFailurePoint::AfterFileSync)?;

        let final_name = match name {
            Some(name) => name.to_string(),
            None => final_backup_name(schema_version, &app_version),
        };
        let target = backup_dir.join(final_name);
        // A derived name embeds a fresh ULID, so a collision means the same
        // millisecond produced two publications; never overwrite a verified
        // backup. A caller-named target is an explicit choice — the save dialog
        // already asked — and replacing it is the point.
        let target_existed = target.exists();
        if !caller_named && target_existed {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        std::fs::rename(&temp_path, &target)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        final_path = Some(target.clone());
        target_pre_existed = target_existed;
        failpoint_stage(BackupFailurePoint::AfterRename)?;

        let fingerprint = hash_file(&target)?;
        sync_directory(backup_dir)?;
        failpoint_stage(BackupFailurePoint::AfterDirSync)?;

        let canonical = std::fs::canonicalize(&target)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        Ok(BackupToken::new(
            OperationId::generate(),
            canonical,
            schema_version,
            fingerprint,
        ))
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
        // Only a target this publication created is ours to remove. One that
        // pre-existed holds the validated, `fsync`ed replacement by now: the
        // export has already replaced the user's file, so undoing that would be
        // a data loss, not a rollback.
        if !target_pre_existed {
            if let Some(target) = &final_path {
                let _ = std::fs::remove_file(target);
            }
        }
    }
    // The rename moves only the base file, so the temp publication's SQLite
    // sidecars keep their temp name and would otherwise be orphaned by every
    // successful publication — with a ULID that matches no published backup.
    remove_temp_sidecars(&temp_path);
    result
}

/// Write a validated copy of the database at `source_path` to exactly
/// `target_path`, replacing any existing file.
///
/// Same publication protocol as [`publish_backup`] — online copy, manifest
/// validation, `fsync`, atomic rename, directory `fsync` — but the caller names
/// the file. The staged temp lives beside the target, so the final rename stays
/// on one filesystem.
///
/// Because the destination is the user's rather than the app's, three things
/// differ: the directory's mode is left as the user set it (never tightened to
/// `0700`), no failure deletes a target that pre-existed — a failure before the
/// rename leaves the old content untouched and a failure after it leaves the
/// validated replacement in place rather than removing the user's file — and
/// nothing sweeps that directory afterwards, since
/// [`cleanup_interrupted_publications`] only walks Notchy's own backup
/// directories. A temp orphaned by a `SIGKILL` mid-export therefore stays beside
/// the target until the user removes it.
///
/// The returned path is `target_path` exactly as given, not canonicalized, and
/// it carries none of the publication ULID: exports are user-named artifacts,
/// not recovery points, and discovery ignores them.
pub fn export_backup_to(source_path: &Path, target_path: &Path) -> DbResult<PathBuf> {
    export_backup_to_at(source_path, target_path, BackupFailurePoint::None)
}

/// [`export_backup_to`] with a failure point injected, so the export path can be
/// exercised at every stage of the publication protocol.
pub fn export_backup_to_at(
    source_path: &Path,
    target_path: &Path,
    failpoint: BackupFailurePoint,
) -> DbResult<PathBuf> {
    let backup_dir = target_path
        .parent()
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    publish_backup_named(source_path, backup_dir, Some(file_name), failpoint)?;
    Ok(target_path.to_path_buf())
}

/// Remove the SQLite sidecars of a temp publication file.
///
/// `copy_online` opens its destination with the live connection policy (which
/// forces WAL), so the temp file acquires `-journal`/`-wal`/`-shm` companions
/// that the atomic rename does not move.
fn remove_temp_sidecars(temp_path: &Path) {
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", temp_path.display(), suffix));
        let _ = std::fs::remove_file(sidecar);
    }
}

/// Copy the source database into `temp_path` through SQLite's online backup
/// API. The destination is opened with the exact live connection policy and
/// private permissions.
fn copy_online(source_path: &Path, temp_path: &Path) -> DbResult<()> {
    let source = open_read_only_at(source_path)?;
    let mut dest = open_live_at(temp_path)?;
    let backup = Backup::new(&source, &mut dest).map_err(map_sqlite_error)?;
    backup
        .run_to_completion(256, Duration::from_millis(10), None)
        .map_err(map_sqlite_error)?;
    Ok(())
}

/// Read the source schema version and the last successfully recorded source
/// application version from `app_meta`.
fn read_source_meta(connection: &Connection) -> DbResult<(i64, String)> {
    let schema_version: String = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    let schema_version = schema_version
        .parse::<i64>()
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

    let app_version: Option<String> = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'last_successful_app_version'",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
        .map_err(map_sqlite_error)?;
    let app_version = app_version.unwrap_or_else(|| UNKNOWN_APP_VERSION.to_string());

    Ok((schema_version, app_version))
}

fn sync_file(path: &Path) -> DbResult<()> {
    let file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    file.sync_all()
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    Ok(())
}

fn sync_directory(dir: &Path) -> DbResult<()> {
    let directory = std::fs::File::open(dir)
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    directory
        .sync_all()
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    Ok(())
}

fn hash_file(path: &Path) -> DbResult<String> {
    let bytes = std::fs::read(path).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    Ok(blake3::hash(&bytes).to_hex().to_string())
}

/// The final backup filename, using the last successfully recorded source
/// application version (sanitized to `[0-9A-Za-z.-_]`) and a fresh ULID.
fn final_backup_name(schema_version: i64, app_version: &str) -> String {
    let safe_app = app_version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("{FINAL_PREFIX}{schema_version}-{safe_app}-{}{FINAL_SUFFIX}", OperationId::generate().as_str())
}

// ---------------------------------------------------------------------------
// Discovery and revalidation
// ---------------------------------------------------------------------------

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
    let stem = name.strip_suffix(FINAL_SUFFIX)?;
    let stem = stem.strip_prefix(FINAL_PREFIX)?;
    // stem = "<schema>-<app-version>-<ULID>"; the ULID is the final segment
    // and the app version may itself contain dashes.
    let (schema_and_app, ulid) = stem.rsplit_once('-')?;
    let (schema, app) = schema_and_app.split_once('-')?;
    if schema.is_empty() || !schema.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if app.is_empty()
        || !app.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_'
        })
    {
        return None;
    }
    if ulid.len() != 26 || !ulid.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
        return None;
    }
    if ulid::Ulid::from_string(ulid).is_err() {
        return None;
    }
    Some(ParsedBackupName {
        schema: schema.parse().ok()?,
        app_version: app.to_string(),
        ulid: ulid.to_string(),
    })
}

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
/// The stamp is the exact output of the pre-port JS writer's
/// `new Date().toISOString().replace(/[:.]/g, '-')`:
/// `YYYY-MM-DDTHH-MM-SS-mmmZ`, 24 characters. Shape is checked by position, and
/// the seven fields are then checked as an instant: a well-shaped stamp naming
/// an impossible date or a pre-epoch time is not a candidate, because
/// `new Date().toISOString()` cannot produce one and the record's ULID is
/// derived from this value. Near-misses (`notchy-backup-notadate.sqlite`, a
/// bare date, a missing `Z`) are not candidates either.
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
    // Every byte is now an ASCII digit or a validated separator, so the fields
    // sit on char boundaries.
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

    let days = days_from_civil(year, month as u32, day as u32);
    let seconds = days * 86_400 + hour * 3_600 + minute * 60 + second;
    if seconds < 0 {
        return None;
    }
    Some(seconds as u64 * 1_000 + millis as u64)
}

struct ParsedBackupName {
    schema: i64,
    app_version: String,
    ulid: String,
}

/// Discover every verified backup reachable from `backup_dir`, newest first:
/// the backup directory itself plus its `upgrades/` subdirectory, where
/// pre-upgrade backups are published.
///
/// Every candidate matching either backup filename shape — the published
/// `notchy-backup-v<schema>-<app>-<ULID>.sqlite` or the legacy routine
/// `notchy-backup-<ISO timestamp>.sqlite` — is revalidated through a true
/// read-only connection against the manifest for its schema. Candidates that
/// fail to open or fail validation are excluded — a corrupt file with a
/// matching name can never displace a verified recovery point.
pub fn discover_verified_backups(
    backup_dir: impl AsRef<Path>,
) -> DbResult<Vec<BackupSummary>> {
    let backup_dir = backup_dir.as_ref();
    let mut records = scan_verified_backups(backup_dir)?;
    // A missing `upgrades/` directory simply has no upgrade backups in it.
    records.extend(
        scan_verified_backups(&backup_dir.join(UPGRADES_DIR)).unwrap_or_default(),
    );
    // Newest first: ULIDs sort chronologically and lexicographically.
    records.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(records)
}

/// Revalidate and collect the verified backups in exactly one directory.
///
/// Both filename shapes are candidates; the name is only a hint about where a
/// candidate's schema and app version come from, and every candidate is
/// confirmed against its own bytes before it is returned.
fn scan_verified_backups(backup_dir: &Path) -> DbResult<Vec<BackupSummary>> {
    let entries = std::fs::read_dir(backup_dir)
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    let mut records = Vec::new();
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
                // genuinely newer one on the recovery screen. A ULID derived
                // from the stamp sorts correctly against published backups,
                // whose ULIDs encode their own creation time.
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
    Ok(records)
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/// The backup files to delete so retention protects the newest `keep_per_schema`
/// verified records per source schema.
///
/// The newly published backup is the newest record in its source-schema group
/// and is therefore always protected. Records from different source schemas are
/// independent: each group keeps its own newest two.
pub fn retention_deletions(
    records: &[BackupSummary],
    keep_per_schema: usize,
) -> Vec<PathBuf> {
    let mut by_schema: BTreeMap<i64, Vec<&BackupSummary>> =
        BTreeMap::new();
    for record in records {
        by_schema
            .entry(record.schema_version)
            .or_default()
            .push(record);
    }
    let mut deletions = Vec::new();
    for group in by_schema.values_mut() {
        group.sort_by(|a, b| b.id.cmp(&a.id));
        for record in group.iter().skip(keep_per_schema) {
            deletions.push(PathBuf::from(&record.path));
        }
    }
    deletions
}

// ---------------------------------------------------------------------------
// Restart cleanup
// ---------------------------------------------------------------------------

/// Remove unpublished publication temp files (and their sidecars) left by a
/// killed process. Verified backups are never touched.
///
/// A missing or unreadable directory is treated as "nothing to clean" so
/// restart cleanup can never block startup.
pub fn cleanup_interrupted_publications(backup_dir: &Path) -> DbResult<usize> {
    let Ok(entries) = std::fs::read_dir(backup_dir) else {
        return Ok(0);
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_temp_name(&name) {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
        remove_temp_sidecars(&entry.path());
    }
    Ok(removed)
}

/// True when `name` is an unpublished publication's temp file *or* one of that
/// temp file's SQLite sidecars.
///
/// A killed publication can leave a sidecar behind after its base temp file
/// has already been renamed away, so a sidecar has to be matchable on its own.
/// Published backups never start with the temp prefix, so a verified backup and
/// its sidecars are never matched.
fn is_temp_name(name: &str) -> bool {
    let base = name
        .strip_suffix("-journal")
        .or_else(|| name.strip_suffix("-wal"))
        .or_else(|| name.strip_suffix("-shm"))
        .unwrap_or(name);
    base.starts_with(TEMP_PREFIX) && base.ends_with(TEMP_SUFFIX)
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/// Format a ULID's embedded creation time as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
fn format_ulid_timestamp(ulid: &str) -> String {
    match ulid::Ulid::from_string(ulid) {
        Ok(ulid) => format_millis_iso(ulid.timestamp_ms()),
        Err(_) => String::new(),
    }
}

fn format_millis_iso(millis: u64) -> String {
    let seconds = millis / 1000;
    let millis = millis % 1000;
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Convert days since the Unix epoch to a (year, month, day) civil date using
/// Howard Hinnant's `civil_from_days` algorithm (same as the migration runner).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 { month_prime + 3 } else { month_prime - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// The number of days in `month` of `year`, February included.
fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Convert a civil date to days since the Unix epoch: the inverse of
/// [`civil_from_days`], using Howard Hinnant's `days_from_civil` algorithm.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - if month <= 2 { 1 } else { 0 };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year =
        (153 * (month as i64 + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i64 - 1;
    let day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
