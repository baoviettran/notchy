//! Integration tests for durable backup publication, verified discovery, and
//! retention (Task 4).
//!
//! Covers: publication is not visible before validation/sync/rename at every
//! failpoint, a corrupt file with a matching backup filename never displaces a
//! verified backup, retention keeps the newest two verified records per source
//! schema, and restart cleanup removes unpublished temp files left by a killed
//! publication without deleting verified backups.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notchy_lib::database::backup::{
    cleanup_interrupted_publications, discover_verified_backups, publish_backup,
    retention_deletions, BackupFailurePoint,
};
use notchy_lib::database::types::BackupSummary;

/// Path of the committed native fixtures, anchored to the crate manifest so the
/// tests work regardless of the invoking cwd.
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
        "notchy-backup-test-{}-{tag}-{nanos}",
        std::process::id()
    ))
}

/// The published-backup filename prefix, kept in lockstep with
/// `src-tauri/src/database/backup.rs`.
const FINAL_PREFIX: &str = "notchy-backup-v";

/// The temporary-publication filename prefix, kept in lockstep with
/// `src-tauri/src/database/backup.rs`.
const TEMP_PREFIX: &str = ".notchy-backup-";

/// True when `name` matches the published-backup pattern
/// `notchy-backup-v<schema>-<app-version>-<ULID>.sqlite`.
fn is_final_backup_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".sqlite") else {
        return false;
    };
    let Some(stem) = stem.strip_prefix(FINAL_PREFIX) else {
        return false;
    };
    // stem = "<schema>-<app-version>-<ULID>"; the ULID is the final segment.
    let Some((schema_and_app, ulid)) = stem.rsplit_once('-') else {
        return false;
    };
    if ulid.len() != 26 || !ulid.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()) {
        return false;
    }
    let Some((schema, app)) = schema_and_app.split_once('-') else {
        return false;
    };
    !schema.is_empty()
        && schema.bytes().all(|b| b.is_ascii_digit())
        && !app.is_empty()
        && app.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_'
        })
}

/// True when `name` is an unpublished publication temp file.
fn is_temp_name(name: &str) -> bool {
    name.starts_with(TEMP_PREFIX) && name.ends_with(".tmp")
}

fn has_final_backup_file(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        is_final_backup_name(&name.to_string_lossy())
    })
}

fn has_temp_file(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        is_temp_name(&name.to_string_lossy())
    })
}

/// A live source database and its destination backup directory.
struct BackupHarness {
    source: PathBuf,
    backup_dir: PathBuf,
}

impl BackupHarness {
    fn from_fixture(fixture: &str) -> Self {
        let root = scratch_root("harness");
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.sqlite");
        std::fs::copy(fixtures_dir().join(fixture), &source)
            .unwrap_or_else(|_| panic!("fixture {fixture} must exist"));
        let backup_dir = root.join("backups");
        std::fs::create_dir_all(&backup_dir).unwrap();
        BackupHarness { source, backup_dir }
    }
}

/// At every named failpoint `publish_backup` must fail, and no final backup
/// file (and no leftover temp file) may ever be visible.
fn assert_err_at_each_failpoint(harness: &BackupHarness, names: [&str; 5]) {
    for name in names {
        let failpoint = BackupFailurePoint::from_name(name)
            .unwrap_or_else(|| panic!("unknown failpoint: {name}"));
        let result = publish_backup(&harness.source, &harness.backup_dir, failpoint);
        assert!(result.is_err(), "publish_backup must fail at failpoint {name}");
        assert!(
            !has_final_backup_file(&harness.backup_dir),
            "final backup must never be visible after failpoint {name}"
        );
        assert!(
            !has_temp_file(&harness.backup_dir),
            "temp file must be cleaned up after failpoint {name}"
        );
    }
}

/// The destination directory must be empty of backup artifacts before any
/// publication runs.
fn assert_no_final_file_before_publish(harness: &BackupHarness) {
    assert!(
        !has_final_backup_file(&harness.backup_dir),
        "no final backup may exist before publish"
    );
    assert!(!has_temp_file(&harness.backup_dir));
}

/// A directory holding one verified schema-4 backup and a corrupt file that
/// matches the published-backup filename pattern.
fn dir_with_verified_and_corrupt_match() -> PathBuf {
    let dir = scratch_root("corrupt");
    std::fs::create_dir_all(&dir).unwrap();

    let verified = dir.join("notchy-backup-v4-0.1.4-01M074EKWMKS2MWWFY36YRSJMR.sqlite");
    std::fs::copy(fixtures_dir().join("v004.sqlite"), &verified).unwrap();

    // Same filename shape, but not a usable SQLite database at all.
    let corrupt = dir.join("notchy-backup-v4-0.1.4-01M074EKWMKS2MWWFY36YRSJMQ.sqlite");
    std::fs::write(&corrupt, b"this is not a sqlite database at all").unwrap();

    dir
}

fn summary(id: &str, path: &str, schema: i64) -> BackupSummary {
    BackupSummary {
        id: id.to_string(),
        path: path.to_string(),
        schema_version: schema,
        source_app_version: "0.1.4".to_string(),
        created_at: String::new(),
        verified: true,
    }
}

/// Poll until an unpublished temp file appears in `dir`.
fn wait_for_temp_file(dir: &Path) {
    for _ in 0..500 {
        if has_temp_file(dir) {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("backup probe never left a temp file");
}

// ---------------------------------------------------------------------------
// Brief Step 1 canonical tests
// ---------------------------------------------------------------------------

#[test]
fn backup_is_not_visible_until_validated_synced_and_renamed() {
    let harness = BackupHarness::from_fixture("v004.sqlite");
    assert_err_at_each_failpoint(&harness, [
        "after_copy",
        "after_validate",
        "after_file_sync",
        "after_rename",
        "after_dir_sync",
    ]);
    assert_no_final_file_before_publish(&harness);
}

#[test]
fn backup_corrupt_matching_filename_never_displaces_verified_backup() {
    let records = discover_verified_backups(dir_with_verified_and_corrupt_match()).unwrap();
    assert_eq!(records.len(), 1);
    assert!(retention_deletions(&records, 2).is_empty());
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

#[test]
fn backup_retention_keeps_newest_two_per_source_schema() {
    // Six records across two source schemas; ULIDs sort chronologically, so
    // the last character (R > Q > P > N > M > L) orders newest to oldest.
    let records = vec![
        summary("01M074EKWMKS2MWWFY36YRSJMR", "/backups/v6-newest.sqlite", 6),
        summary("01M074EKWMKS2MWWFY36YRSJMQ", "/backups/v6-middle.sqlite", 6),
        summary("01M074EKWMKS2MWWFY36YRSJMP", "/backups/v6-oldest.sqlite", 6),
        summary("01M074EKWMKS2MWWFY36YRSJMN", "/backups/v4-newest.sqlite", 4),
        summary("01M074EKWMKS2MWWFY36YRSJMM", "/backups/v4-middle.sqlite", 4),
        summary("01M074EKWMKS2MWWFY36YRSJML", "/backups/v4-oldest.sqlite", 4),
    ];

    let deletions = retention_deletions(&records, 2);
    assert_eq!(deletions.len(), 2);
    assert!(deletions.contains(&PathBuf::from("/backups/v6-oldest.sqlite")));
    assert!(deletions.contains(&PathBuf::from("/backups/v4-oldest.sqlite")));
}

// ---------------------------------------------------------------------------
// Restart cleanup of an interrupted publication
// ---------------------------------------------------------------------------

#[test]
fn backup_restart_cleanup_removes_unpublished_temp_files() {
    let harness = BackupHarness::from_fixture("v004.sqlite");

    // A first publication succeeds and yields an opaque token bound to the
    // canonical path and the source schema.
    let token = publish_backup(&harness.source, &harness.backup_dir, BackupFailurePoint::None)
        .expect("first publication must succeed");
    assert!(token.path().exists());
    assert_eq!(token.schema(), 4);
    assert_eq!(
        discover_verified_backups(&harness.backup_dir).unwrap().len(),
        1
    );

    // A second publication starts in a subprocess that hangs right after the
    // copy, then is killed mid-publication: an unpublished `.tmp` file remains.
    let mut child = Command::new(env!("CARGO_BIN_EXE_backup_probe"))
        .arg("publish-hang-after-copy")
        .arg(&harness.backup_dir)
        .arg(&harness.source)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn backup_probe");
    wait_for_temp_file(&harness.backup_dir);
    let _ = child.kill();
    let _ = child.wait();

    assert!(
        has_temp_file(&harness.backup_dir),
        "a killed publication must leave an unpublished temp file"
    );

    // Restart cleanup removes the temp file and keeps the verified backup.
    cleanup_interrupted_publications(&harness.backup_dir).expect("cleanup must succeed");
    assert!(!has_temp_file(&harness.backup_dir));
    let records = discover_verified_backups(&harness.backup_dir).unwrap();
    assert_eq!(
        records.len(),
        1,
        "verified backups must survive restart cleanup"
    );
}

// ---------------------------------------------------------------------------
// Restore-related tests (Task 12)
// ---------------------------------------------------------------------------

use notchy_lib::database::restore::{discover_restore_points, RestoreFailurePoint};

/// Restore failpoint names must be stable snake_case.
#[test]
fn restore_failpoint_names_are_stable() {
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

/// `discover_restore_points` is a thin wrapper; it must return verified backups
/// (same as `discover_verified_backups`) from a directory with known backups.
#[test]
fn discover_restore_points_returns_verified_backups() {
    let dir = dir_with_verified_and_corrupt_match();
    let points = discover_restore_points(&dir).unwrap();
    assert_eq!(points.len(), 1, "corrupt files must be excluded");
    assert!(points[0].verified);
}

/// `discover_restore_points` returns empty for an empty directory.
#[test]
fn discover_restore_points_empty_dir() {
    let dir = scratch_root("empty");
    std::fs::create_dir_all(&dir).unwrap();
    let points = discover_restore_points(&dir).unwrap();
    assert!(points.is_empty());
}

/// `discover_restore_points` returns empty for a missing directory.
#[test]
fn discover_restore_points_missing_dir() {
    let dir = scratch_root("missing");
    let points = discover_restore_points(&dir).unwrap();
    assert!(points.is_empty());
}
