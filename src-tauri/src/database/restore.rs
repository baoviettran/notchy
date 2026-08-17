//! Crash-safe database restore protocol (Task 12).
//!
//! The restore operation replaces the live database with a verified backup while
//! guaranteeing that after any crash — at any point in the sequence — the live
//! database is either the accepted pre-operation database or the fully validated
//! post-operation database. There is never a truncated or partial live database.
//!
//! The sequence is:
//!
//! 1. Enter `Restoring` lifecycle state (rejects pending jobs).
//! 2. Publish a rollback backup of the current live database.
//! 3. Revalidate the provided `BackupToken` (path, fingerprint, schema).
//! 4. Copy the backup to a temporary file beside the live database.
//! 5. `fsync` the temporary file.
//! 6. Close the live connection (drop it).
//! 7. Retire journals / legacy WAL sidecars.
//! 8. Atomic rename the temporary file over the live database path.
//! 9. `fsync` the destination directory.
//! 10. Reopen with the exact live connection pragmas.
//! 11. Migrate if the schema version is supported.
//! 12. Validate the schema is the current version (6).
//! 13. Enter `Ready` state.

use std::cell::Cell;
use std::fs::{self, OpenOptions};
use std::path::Path;

use crate::database::backup::{
    BackupFailurePoint, cleanup_interrupted_publications, discover_verified_backups, publish_backup,
};
use crate::database::connection::{create_dir_private, open_live_at, open_read_only_at};
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::executor::{DatabaseManager, ExecutorState};
use crate::database::manifest::{inspect_schema, validate_manifest, SchemaInspection};
use crate::database::migrations::{
    run_migrations, FailurePoint, LATEST_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION,
};
use crate::database::types::{BackupSummary, BackupToken};

use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Failure-point injection
// ---------------------------------------------------------------------------

/// Fault-injection points in the restore sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreFailurePoint {
    /// Run without injected failure.
    None,
    /// Fail after the rollback backup is published.
    AfterRollback,
    /// Fail after the backup is copied to a temp file beside the live DB.
    AfterRestoreCopy,
    /// Fail after the temp file is `fsync`ed.
    AfterRestoreFileSync,
    /// Fail after the live connection is closed.
    AfterCloseConnection,
    /// Fail after journals and WAL sidecars are retired.
    AfterRetireJournals,
    /// Fail after the atomic rename replaces the live database.
    AfterRename,
    /// Fail after the destination directory is `fsync`ed.
    AfterDirSync,
}

impl RestoreFailurePoint {
    /// Stable snake_case name, matching the strings used by the tests.
    pub fn name(self) -> &'static str {
        match self {
            RestoreFailurePoint::None => "none",
            RestoreFailurePoint::AfterRollback => "after_rollback",
            RestoreFailurePoint::AfterRestoreCopy => "after_restore_copy",
            RestoreFailurePoint::AfterRestoreFileSync => "after_restore_file_sync",
            RestoreFailurePoint::AfterCloseConnection => "after_close_connection",
            RestoreFailurePoint::AfterRetireJournals => "after_retire_journals",
            RestoreFailurePoint::AfterRename => "after_rename",
            RestoreFailurePoint::AfterDirSync => "after_dir_sync",
        }
    }

    /// Resolve a snake_case name to a failpoint, or `None` for unknown names.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "after_rollback" => Some(RestoreFailurePoint::AfterRollback),
            "after_restore_copy" => Some(RestoreFailurePoint::AfterRestoreCopy),
            "after_restore_file_sync" => Some(RestoreFailurePoint::AfterRestoreFileSync),
            "after_close_connection" => Some(RestoreFailurePoint::AfterCloseConnection),
            "after_retire_journals" => Some(RestoreFailurePoint::AfterRetireJournals),
            "after_rename" => Some(RestoreFailurePoint::AfterRename),
            "after_dir_sync" => Some(RestoreFailurePoint::AfterDirSync),
            _ => None,
        }
    }
}

thread_local! {
    static RESTORE_FAILPOINT: Cell<Option<RestoreFailurePoint>> = const { Cell::new(None) };
}

fn set_restore_failpoint(failpoint: RestoreFailurePoint) {
    RESTORE_FAILPOINT.with(|slot| slot.set(Some(failpoint)));
}

fn fire_restore_failpoint(stage: RestoreFailurePoint) -> DbResult<()> {
    let target = RESTORE_FAILPOINT.with(Cell::get);
    if target == Some(stage) {
        return Err(DbError::new(ErrorCode::RestoreFailed));
    }
    Ok(())
}

/// Arm the restore failpoint for the current thread. Used by integration tests
/// and the `DatabaseManager::restore_database` path.
pub fn arm_restore_failpoint(failpoint: RestoreFailurePoint) {
    set_restore_failpoint(failpoint);
}

/// Clear the restore failpoint (resets to `None`).
pub fn clear_restore_failpoint() {
    set_restore_failpoint(RestoreFailurePoint::None);
}

// ---------------------------------------------------------------------------
// Token revalidation
// ---------------------------------------------------------------------------

/// Revalidate a `BackupToken` by re-reading the file at its canonical path,
/// rehashing, and checking the schema version matches.
fn revalidate_token(token: &BackupToken) -> DbResult<()> {
    let path = token.path();
    if !path.exists() {
        return Err(DbError::new(ErrorCode::RestoreFailed));
    }

    // Rehash the backup file and compare with the token's fingerprint.
    let bytes = fs::read(path).map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    let fingerprint = blake3::hash(&bytes).to_hex().to_string();
    if fingerprint != token.fingerprint() {
        return Err(DbError::new(ErrorCode::RestoreFailed));
    }

    // Verify the schema version in the backup matches the token.
    let connection = open_read_only_at(path)?;
    let schema_version: String = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    let version = schema_version
        .parse::<i64>()
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    if version != token.schema() {
        return Err(DbError::new(ErrorCode::RestoreFailed));
    }

    // Full manifest validation.
    validate_manifest(&connection, token.schema())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Journal / WAL retirement
// ---------------------------------------------------------------------------

/// Remove sidecar files left by the previous live connection's journal mode.
/// This covers `-journal` (DELETE mode), `-wal`, and `-shm` (WAL mode).
/// Sidecars beside the live database path are retired; a missing sidecar is
/// not an error (the connection may have been in DELETE mode without a journal).
fn retire_journals(db_path: &Path) -> DbResult<()> {
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", db_path.display(), suffix));
        if sidecar.exists() {
            fs::remove_file(&sidecar).map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
        }
    }
    Ok(())
}

/// Sync the directory containing `db_path` to ensure the rename is durable.
fn sync_directory(db_path: &Path) -> DbResult<()> {
    let dir = db_path.parent().ok_or_else(|| DbError::new(ErrorCode::RestoreFailed))?;
    let file = OpenOptions::new()
        .read(true)
        .open(dir)
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    file.sync_all()
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    Ok(())
}

/// `fsync` a file to ensure its contents are durable.
fn sync_file(path: &Path) -> DbResult<()> {
    let file = OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    file.sync_all()
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Restore entry point
// ---------------------------------------------------------------------------

/// Perform the full crash-safe restore protocol on the executor thread.
///
/// The connection in `state` is closed before the database file is replaced;
/// a fresh connection with the exact live pragmas is installed after the atomic
/// rename. On any failure the boundary enters `RecoveryRequired` with safe
/// backup summaries.
///
/// **Crash safety invariant**: after any failure at any point in the sequence,
/// the live database is either the original pre-operation database (rollback
/// succeeded) or the fully validated post-operation database (rename + reopen
/// + validate succeeded). There is never a truncated or partial live database.
pub(crate) fn perform_restore(
    manager: &DatabaseManager,
    state: &mut ExecutorState,
    token: BackupToken,
    failpoint: RestoreFailurePoint,
) -> DbResult<()> {
    set_restore_failpoint(failpoint);

    let paths = manager.paths();
    let backup_dir = manager.backup_dir();

    // ── Step 1: Reject/drain pending jobs (caller already set Restoring) ──

    // ── Step 2: Publish rollback backup of current live DB ──────────────
    let _rollback_token = publish_backup(&paths.db_path, &backup_dir, BackupFailurePoint::None)?;
    fire_restore_failpoint(RestoreFailurePoint::AfterRollback)?;

    // ── Step 3: Revalidate the provided backup token ────────────────────
    revalidate_token(&token)?;

    // ── Step 4: Copy backup to a temp file beside the live DB ───────────
    let data_dir = paths.db_path.parent().ok_or_else(|| DbError::new(ErrorCode::RestoreFailed))?;
    create_dir_private(data_dir).map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;

    let temp_path = data_dir.join(".notchy-restore-temp.sqlite");
    // Online copy through the SQLite backup API (same approach as publish_backup).
    {
        let source_conn = open_read_only_at(token.path())?;
        let mut dest_conn = open_live_at(&temp_path)?;
        let backup = rusqlite::backup::Backup::new(&source_conn, &mut dest_conn)
            .map_err(map_sqlite_error)?;
        backup
            .run_to_completion(256, std::time::Duration::from_millis(10), None)
            .map_err(map_sqlite_error)?;
    }
    fire_restore_failpoint(RestoreFailurePoint::AfterRestoreCopy)?;

    // ── Step 5: Validate the copy ──────────────────────────────────────
    {
        let copy_conn = open_read_only_at(&temp_path)?;
        validate_manifest(&copy_conn, token.schema())?;
    }

    // ── Step 6: fsync the temp file ─────────────────────────────────────
    sync_file(&temp_path)?;
    fire_restore_failpoint(RestoreFailurePoint::AfterRestoreFileSync)?;

    // ── Step 7: Close the live connection ───────────────────────────────
    // Dropping the connection ensures no WAL/SHM sidecars are held open.
    let _old_conn = state.take_connection();
    drop(_old_conn);
    fire_restore_failpoint(RestoreFailurePoint::AfterCloseConnection)?;

    // ── Step 8: Retire journals / WAL sidecars ──────────────────────────
    retire_journals(&paths.db_path)?;
    fire_restore_failpoint(RestoreFailurePoint::AfterRetireJournals)?;

    // ── Step 9: Atomic rename temp → live ───────────────────────────────
    fs::rename(&temp_path, &paths.db_path)
        .map_err(|_| DbError::new(ErrorCode::RestoreFailed))?;
    fire_restore_failpoint(RestoreFailurePoint::AfterRename)?;

    // ── Step 10: Sync destination directory ─────────────────────────────
    sync_directory(&paths.db_path)?;
    fire_restore_failpoint(RestoreFailurePoint::AfterDirSync)?;

    // ── Step 11: Reopen with exact live connection pragmas ──────────────
    let mut connection = open_live_at(&paths.db_path)?;

    // ── Step 12: Migrate if schema version is supported ─────────────────
    match inspect_schema(&paths.db_path) {
        SchemaInspection::Current { .. } => {
            // Already at the latest schema; nothing to do.
        }
        SchemaInspection::Older { version }
            if version >= MIN_SUPPORTED_SCHEMA_VERSION =>
        {
            run_migrations(&mut connection, LATEST_SCHEMA_VERSION, FailurePoint::None)?;
        }
        other => {
            // Fresh, too old, newer, or invalid after restore is a fatal error.
            let code = match other {
                SchemaInspection::Fresh => ErrorCode::DatabaseInvalid,
                SchemaInspection::TooOld { .. } => ErrorCode::SchemaTooOld,
                SchemaInspection::Newer { .. } => ErrorCode::SchemaTooNew,
                _ => ErrorCode::DatabaseInvalid,
            };
            return Err(DbError::new(code));
        }
    }

    // ── Step 13: Validate schema is current version ─────────────────────
    validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;

    // ── Install the new connection ──────────────────────────────────────
    state.store_connection(connection)?;

    // Clean up any temp files from failed rollback publications.
    let _ = cleanup_interrupted_publications(&backup_dir);

    Ok(())
}

/// Discover all verified backups available for restore, newest first.
///
/// A missing or unreadable directory is treated as "no restore points" rather
/// than an error, so callers never fail just because the backup directory
/// hasn't been created yet.
pub fn discover_restore_points(
    backup_dir: &Path,
) -> DbResult<Vec<BackupSummary>> {
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    discover_verified_backups(backup_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failpoint_names_are_snake_case() {
        assert_eq!(RestoreFailurePoint::None.name(), "none");
        assert_eq!(RestoreFailurePoint::AfterRollback.name(), "after_rollback");
        assert_eq!(
            RestoreFailurePoint::AfterRestoreCopy.name(),
            "after_restore_copy"
        );
        assert_eq!(
            RestoreFailurePoint::AfterRestoreFileSync.name(),
            "after_restore_file_sync"
        );
        assert_eq!(
            RestoreFailurePoint::AfterCloseConnection.name(),
            "after_close_connection"
        );
        assert_eq!(
            RestoreFailurePoint::AfterRetireJournals.name(),
            "after_retire_journals"
        );
        assert_eq!(RestoreFailurePoint::AfterRename.name(), "after_rename");
        assert_eq!(
            RestoreFailurePoint::AfterDirSync.name(),
            "after_dir_sync"
        );
    }

    #[test]
    fn failpoint_from_name_roundtrips() {
        for variant in [
            RestoreFailurePoint::AfterRollback,
            RestoreFailurePoint::AfterRestoreCopy,
            RestoreFailurePoint::AfterRestoreFileSync,
            RestoreFailurePoint::AfterCloseConnection,
            RestoreFailurePoint::AfterRetireJournals,
            RestoreFailurePoint::AfterRename,
            RestoreFailurePoint::AfterDirSync,
        ] {
            let name = variant.name();
            assert_eq!(
                RestoreFailurePoint::from_name(name),
                Some(variant),
                "roundtrip failed for {name}"
            );
        }
        assert_eq!(RestoreFailurePoint::from_name("unknown"), None);
    }
}
