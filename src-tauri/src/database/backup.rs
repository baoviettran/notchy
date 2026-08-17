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
use std::time::Duration;

use rusqlite::backup::Backup;
use rusqlite::Connection;

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

/// Publish a verified, durable backup of `source_path` into `backup_dir`.
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
    set_failpoint(failpoint);
    create_dir_private(backup_dir).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

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
    let result = (|| -> DbResult<BackupToken> {
        copy_online(source_path, &temp_path)?;
        failpoint_stage(BackupFailurePoint::AfterCopy)?;

        let copy = open_read_only_at(&temp_path)?;
        validate_manifest(&copy, schema_version)?;
        drop(copy);
        failpoint_stage(BackupFailurePoint::AfterValidate)?;

        sync_file(&temp_path)?;
        failpoint_stage(BackupFailurePoint::AfterFileSync)?;

        let target = backup_dir.join(final_backup_name(schema_version, &app_version));
        // The final name embeds a fresh ULID, so a collision means the same
        // millisecond produced two publications; never overwrite a verified
        // backup.
        if target.exists() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        std::fs::rename(&temp_path, &target)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        final_path = Some(target.clone());
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
        if let Some(target) = &final_path {
            let _ = std::fs::remove_file(target);
        }
        for suffix in ["-journal", "-wal", "-shm"] {
            let temp_sidecar = PathBuf::from(format!("{}{}", temp_path.display(), suffix));
            let _ = std::fs::remove_file(temp_sidecar);
        }
    }
    result
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
/// revalidate the candidate. Returns `None` for anything that does not match
/// the published-backup pattern.
fn parse_backup_name(name: &str) -> Option<ParsedBackupName> {
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

struct ParsedBackupName {
    schema: i64,
    app_version: String,
    ulid: String,
}

/// Discover every verified backup in `backup_dir`, newest first.
///
/// Every candidate matching the published-backup filename pattern is
/// revalidated through a true read-only connection against the manifest for
/// the schema recorded in its name. Candidates that fail to open or fail
/// validation are excluded — a corrupt file with a matching name can never
/// displace a verified recovery point.
pub fn discover_verified_backups(
    backup_dir: impl AsRef<Path>,
) -> DbResult<Vec<BackupSummary>> {
    let backup_dir = backup_dir.as_ref();
    let entries = std::fs::read_dir(backup_dir)
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(meta) = parse_backup_name(name) else {
            continue;
        };
        if manifest_for(meta.schema).is_none() {
            continue;
        }
        let Ok(connection) = open_read_only_at(&path) else {
            continue;
        };
        if validate_manifest(&connection, meta.schema).is_err() {
            continue;
        }
        drop(connection);
        let Ok(canonical) = std::fs::canonicalize(&path) else {
            continue;
        };
        records.push(BackupSummary {
            id: meta.ulid.clone(),
            path: canonical.to_string_lossy().into_owned(),
            schema_version: meta.schema,
            source_app_version: meta.app_version,
            created_at: format_ulid_timestamp(&meta.ulid),
            verified: true,
        });
    }
    // Newest first: ULIDs sort chronologically and lexicographically.
    records.sort_by(|a, b| b.id.cmp(&a.id));
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
        for suffix in ["-journal", "-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{}", entry.path().display(), suffix));
            let _ = std::fs::remove_file(sidecar);
        }
    }
    Ok(removed)
}

fn is_temp_name(name: &str) -> bool {
    name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX)
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
