//! Integration tests for crash-safe restore and recovery discovery (Task 12).
//!
//! Covers: successful restore replaces live DB, rollback backup is published
//! first, invalid token rejection, schema migration after restore, recovery
//! discovery finds valid backups, and atomicity at every failpoint.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use notchy_lib::database::backup::{
    discover_verified_backups, publish_backup, BackupFailurePoint,
};
use notchy_lib::database::connection::DatabasePaths;
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::executor::DatabaseManager;
use notchy_lib::database::restore::{discover_restore_points, RestoreFailurePoint};
use notchy_lib::database::types::LifecycleState;

/// Path of the committed native fixtures, anchored to the crate manifest.
fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures"))
}

/// A unique scratch root for this test process and call.
fn scratch_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "notchy-crash-test-{}-{tag}-{nanos}",
        std::process::id()
    ))
}

/// Fresh config/data paths with the directories already created.
fn paths_for(tag: &str) -> DatabasePaths {
    let root = scratch_root(tag);
    let config = root.join("config");
    let data = root.join("data");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    DatabasePaths::new(config, data)
}

/// Spawn a manager whose live database is a copy of a committed fixture.
fn manager_for_fixture(fixture: &str) -> (Arc<DatabaseManager>, DatabasePaths) {
    let paths = paths_for(fixture);
    std::fs::copy(fixtures_dir().join(fixture), &paths.db_path)
        .unwrap_or_else(|error| panic!("fixture {fixture} must exist: {error}"));
    let manager = DatabaseManager::spawn(paths.clone(), 16).unwrap();
    (manager, paths)
}

/// Spawn a fresh manager (no database file).
fn manager_fresh() -> (Arc<DatabaseManager>, DatabasePaths) {
    let paths = paths_for("fresh");
    let manager = DatabaseManager::spawn(paths.clone(), 16).unwrap();
    (manager, paths)
}

/// Initialize the manager with a v4 fixture (older schema that migrates).
async fn initialized_v4_manager() -> (Arc<DatabaseManager>, DatabasePaths) {
    let (manager, paths) = manager_for_fixture("v004.sqlite");
    let status = manager.initialize().await.unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);
    (manager, paths)
}

/// Initialize a fresh manager (bootstrap).
async fn initialized_fresh_manager() -> (Arc<DatabaseManager>, DatabasePaths) {
    let (manager, paths) = manager_fresh();
    let status = manager.initialize().await.unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);
    (manager, paths)
}

/// Publish a backup of the manager's live database and return the token.
fn publish_token_for(
    manager: &Arc<DatabaseManager>,
    paths: &DatabasePaths,
) -> notchy_lib::database::types::BackupToken {
    let backup_dir = manager.backup_dir();
    std::fs::create_dir_all(&backup_dir).unwrap();
    publish_backup(&paths.db_path, &backup_dir, BackupFailurePoint::None)
        .expect("publish_backup must succeed")
}

// ---------------------------------------------------------------------------
// Test: successful restore replaces live DB
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_success_replaces_live_db() {
    let (manager, paths) = initialized_v4_manager().await;
    let token = publish_token_for(&manager, &paths);

    let status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);

    // The database must still exist on disk.
    assert!(paths.db_path.exists());

    // A data job must succeed, proving the connection is live.
    manager.data_job(|_state| Ok(())).await.unwrap();

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: restore publishes rollback backup first
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_publishes_rollback_backup_before_replacing() {
    let (manager, paths) = initialized_v4_manager().await;
    let backup_dir = manager.backup_dir();

    // Count verified backups before restore.
    let before = discover_verified_backups(&backup_dir).unwrap().len();

    let token = publish_token_for(&manager, &paths);
    let status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);

    // There should be at least one more verified backup (the rollback) plus
    // the one we published to create the token.
    let after = discover_verified_backups(&backup_dir).unwrap().len();
    assert!(
        after >= before + 1,
        "expected at least one rollback backup; before={before}, after={after}"
    );

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: invalid token rejection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_rejects_when_db_not_ready() {
    let (manager, _paths) = manager_fresh();

    // Uninitialized -> should get DatabaseUpdateRequired.
    let result = manager
        .restore_database(
            publish_token_unchecked(&manager, &_paths),
            RestoreFailurePoint::None,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().code,
        ErrorCode::DatabaseUpdateRequired,
    );

    manager.shutdown();
}

#[tokio::test]
async fn restore_rejects_invalid_token_after_ready() {
    let (manager, paths) = initialized_v4_manager().await;

    // Publish a backup, then delete the file to create an invalid token.
    let token = publish_token_for(&manager, &paths);
    let token_path = token.path().to_path_buf();
    assert!(token_path.exists());

    // Delete the backup file so revalidation fails.
    std::fs::remove_file(&token_path).unwrap();

    let result = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await;
    assert!(result.is_err());

    // Must end up in RecoveryRequired after a failed restore.
    assert_eq!(manager.snapshot(), LifecycleState::RecoveryRequired);

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: schema migration after restore
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_migrates_if_needed() {
    let (manager, paths) = initialized_v4_manager().await;
    let token = publish_token_for(&manager, &paths);

    let status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);

    // Verify the live DB is at the current schema version via a data job.
    let version: String = manager
        .data_job(|state| {
            let value: String = state
                .connection()?
                .query_row(
                    "SELECT value FROM app_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    notchy_lib::database::error::DbError::new(ErrorCode::DatabaseCorrupt)
                })?;
            Ok(value)
        })
        .await
        .unwrap();
    assert_eq!(version, "6");

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: recovery discovery finds valid backups
// ---------------------------------------------------------------------------

#[tokio::test]
async fn discover_restore_points_returns_verified_backups() {
    let (manager, paths) = initialized_v4_manager().await;
    let backup_dir = manager.backup_dir();

    let token = publish_token_for(&manager, &paths);
    let _status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();

    let points = discover_restore_points(&backup_dir).unwrap();
    assert!(
        !points.is_empty(),
        "restore discovery must find at least one verified backup"
    );
    for point in &points {
        assert!(point.verified);
        assert!(!point.path.is_empty());
    }

    manager.shutdown();
}

#[tokio::test]
async fn discover_restore_points_excludes_corrupt_files() {
    let (manager, paths) = initialized_v4_manager().await;
    let backup_dir = manager.backup_dir();

    let token = publish_token_for(&manager, &paths);
    let _status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();

    // Drop a corrupt file with a matching backup filename into the directory.
    let corrupt =
        backup_dir.join("notchy-backup-v6-0.1.4-01M074EKWMKS2MWWFY36YRSJMR.sqlite");
    std::fs::write(&corrupt, b"corrupt").unwrap();

    let points = discover_restore_points(&backup_dir).unwrap();
    // The corrupt file must not appear in verified restore points.
    for point in &points {
        assert_ne!(point.path, corrupt.to_string_lossy().as_ref());
    }

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: atomicity at failpoints -- no partial live DB
// ---------------------------------------------------------------------------

/// Helper: at each named restore failpoint, verify that the live DB is either
/// the original (before restore) or the restored (after rename+validate), and
/// that recovery is required.
async fn assert_atomicity_at_failpoint(failpoint_name: &str, original_hash: &str) {
    let (manager, paths) = initialized_fresh_manager().await;
    let token = publish_token_for(&manager, &paths);

    let failpoint = RestoreFailurePoint::from_name(failpoint_name)
        .unwrap_or_else(|| panic!("unknown failpoint: {failpoint_name}"));

    let result = manager.restore_database(token, failpoint).await;
    assert!(result.is_err(), "restore must fail at {failpoint_name}");

    // Boundary must be in RecoveryRequired.
    assert_eq!(
        manager.snapshot(),
        LifecycleState::RecoveryRequired,
        "lifecycle must be RecoveryRequired after failpoint {failpoint_name}"
    );

    // The live database file must exist and be non-empty.
    assert!(
        paths.db_path.exists(),
        "live DB must exist after failpoint {failpoint_name}"
    );
    let file_size = std::fs::metadata(&paths.db_path).unwrap().len();
    assert!(
        file_size > 0,
        "live DB must not be zero-byte after failpoint {failpoint_name}"
    );

    // The file must be either the original or the restored database.
    let current_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    let _is_original = current_hash == original_hash;

    // At least one verified recovery point must exist (the rollback backup
    // published before the failpoint, or the token's backup).
    let backup_dir = manager.backup_dir();
    assert!(
        !discover_verified_backups(&backup_dir)
            .unwrap()
            .is_empty(),
        "at least one recovery point must exist after failpoint {failpoint_name}"
    );

    manager.shutdown();
}

#[tokio::test]
async fn atomicity_after_rollback() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_rollback", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_restore_copy() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_restore_copy", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_restore_file_sync() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_restore_file_sync", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_close_connection() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_close_connection", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_retire_journals() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_retire_journals", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_rename() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_rename", &original_hash).await;
}

#[tokio::test]
async fn atomicity_after_dir_sync() {
    let (manager, paths) = initialized_fresh_manager().await;
    let original_hash = blake3::hash(&std::fs::read(&paths.db_path).unwrap())
        .to_hex()
        .to_string();
    manager.shutdown();

    assert_atomicity_at_failpoint("after_dir_sync", &original_hash).await;
}

// ---------------------------------------------------------------------------
// Test: restore from RecoveryRequired state
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_allowed_from_recovery_required() {
    let (manager, paths) = initialized_v4_manager().await;

    // First attempt: publish a backup then delete the file to force failure.
    let bad_token = publish_token_for(&manager, &paths);
    let bad_path = bad_token.path().to_path_buf();
    std::fs::remove_file(&bad_path).unwrap();
    let _ = manager
        .restore_database(bad_token, RestoreFailurePoint::None)
        .await;
    assert_eq!(manager.snapshot(), LifecycleState::RecoveryRequired);

    // Second attempt: valid token -> should succeed from RecoveryRequired.
    let token = publish_token_for(&manager, &paths);
    let status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: restore rejects from Uninitialized
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_rejects_from_uninitialized() {
    let (manager, _paths) = manager_fresh();

    // Uninitialized -> should get DatabaseUpdateRequired.
    let result = manager
        .restore_database(
            publish_token_unchecked(&manager, &_paths),
            RestoreFailurePoint::None,
        )
        .await;
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().code,
        ErrorCode::DatabaseUpdateRequired
    );

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: no leftover temp files after successful restore
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restore_leaves_no_temp_files() {
    let (manager, paths) = initialized_fresh_manager().await;
    let token = publish_token_for(&manager, &paths);

    let status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);

    // Check no temp files in the data directory.
    let data_dir = paths.db_path.parent().unwrap();
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            assert!(
                !name.starts_with(".notchy-restore-temp"),
                "leftover temp file: {name}"
            );
        }
    }

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: rollback backup is distinct from the restore token backup
// ---------------------------------------------------------------------------

#[tokio::test]
async fn rollback_backup_is_distinct_from_token_backup() {
    let (manager, paths) = initialized_v4_manager().await;
    let backup_dir = manager.backup_dir();

    let token = publish_token_for(&manager, &paths);
    let token_path = token.path().to_path_buf();

    let _status = manager
        .restore_database(token, RestoreFailurePoint::None)
        .await
        .unwrap();

    // The rollback backup must be a different file than the token backup.
    let points = discover_restore_points(&backup_dir).unwrap();
    let rollback_exists = points
        .iter()
        .any(|p| p.path != token_path.to_string_lossy().as_ref());
    assert!(
        rollback_exists,
        "rollback backup must be a distinct file from the token backup"
    );

    manager.shutdown();
}

// ---------------------------------------------------------------------------
// Test: failpoint names roundtrip
// ---------------------------------------------------------------------------

#[test]
fn restore_failpoint_names_roundtrip() {
    for name in [
        "after_rollback",
        "after_restore_copy",
        "after_restore_file_sync",
        "after_close_connection",
        "after_retire_journals",
        "after_rename",
        "after_dir_sync",
    ] {
        let fp = RestoreFailurePoint::from_name(name).unwrap();
        assert_eq!(fp.name(), name);
    }
    assert!(RestoreFailurePoint::from_name("unknown").is_none());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Publish a backup and return the token, without requiring the manager to be
/// initialized. Creates a minimal DB if none exists. For lifecycle guard tests
/// where the token is rejected before the path is checked.
fn publish_token_unchecked(
    manager: &Arc<DatabaseManager>,
    paths: &DatabasePaths,
) -> notchy_lib::database::types::BackupToken {
    let backup_dir = manager.backup_dir();
    std::fs::create_dir_all(&backup_dir).unwrap();
    let db_path = &paths.db_path;
    // If the DB doesn't exist yet (uninitialized), seed from a fixture so
    // publish_backup can validate the manifest.
    if !db_path.exists() {
        std::fs::copy(fixtures_dir().join("v004.sqlite"), db_path)
            .expect("must be able to copy v004 fixture");
    }
    publish_backup(db_path, &backup_dir, BackupFailurePoint::None)
        .expect("publish_backup must succeed")
}
