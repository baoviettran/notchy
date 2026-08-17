//! Integration tests for the native schema manifests, fresh bootstrap, and the
//! migrations 1-6 registry (Task 3).
//!
//! Covers: fresh bootstrap, supported v3 and v4 -> v6 migration, current
//! schema acceptance, too-old / newer / invalid read-only rejection with
//! byte-for-byte non-mutation, and failure injection after every statement of
//! every migration proving full atomic rollback.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::{
    bootstrap_current, inspect_schema, migrate_supported, run_migrations, validate_manifest,
    FailurePoint, LATEST_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION, SchemaInspection,
};

/// Path of the committed native fixtures, anchored to the crate manifest so the
/// tests work regardless of the invoking cwd.
fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures"))
}

/// A unique scratch path below the OS temp directory for this test process.
fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("notchy-migrations-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A fresh (absent) scratch path.
fn fresh_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    scratch_dir().join(format!("{tag}-{nanos}.sqlite"))
}

/// Copy a committed fixture into a fresh scratch path and return that path.
fn copy_fixture(name: &str) -> PathBuf {
    let src = fixtures_dir().join(name);
    let dest = fresh_path(name);
    std::fs::copy(&src, &dest).expect("fixture must exist");
    dest
}

/// Open a true read-only connection at an arbitrary path.
fn open_ro(path: &Path) -> Connection {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
}

/// Read the `app_meta.schema_version` value; `0` when no row exists.
fn schema_version(db: &Connection) -> i64 {
    db.query_row(
        "SELECT value FROM app_meta WHERE key = 'schema_version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .map(|value| value.parse::<i64>().unwrap_or(0))
    .unwrap_or(0)
}

fn table_exists(db: &Connection, name: &str) -> bool {
    db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

fn column_exists(db: &Connection, table: &str, column: &str) -> bool {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = db.prepare(&sql).unwrap();
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    columns.iter().any(|c| c == column)
}

/// The migration-003 seed buckets and tags must survive any migration to 6.
fn assert_seed_rows_preserved(db: &Connection) {
    for id in [
        "bucket_essentials",
        "bucket_learning",
        "bucket_saving",
        "bucket_adjustments",
    ] {
        let n: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM category_types WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "seed bucket {id} must survive migration");
    }
    for id in [
        "tag_initial_balance",
        "tag_loss",
        "tag_gift",
        "tag_reconciliation",
    ] {
        let n: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM category_tags WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "seed tag {id} must survive migration");
    }
}

/// Byte snapshot of the database file plus any journal/WAL/SHM sidecars, so a
/// read-only inspection or a rolled-back transaction provably writes nothing.
fn snapshot_file_and_sidecars(path: &Path) -> Vec<u8> {
    let mut out = Vec::new();
    let main = std::fs::read(path).expect("database file must exist");
    out.extend_from_slice(&(main.len() as u64).to_le_bytes());
    out.extend_from_slice(&main);
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.display(), suffix));
        if let Ok(bytes) = std::fs::read(&sidecar) {
            out.extend_from_slice(b"SIDE");
            out.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            out.extend_from_slice(&bytes);
        }
    }
    out
}

/// Build a schema-3 database by running the native migrations 1-3 over a fresh
/// file. Used as the source for the supported-v3 migration tests.
fn build_schema3(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    run_migrations(&mut conn, 3, FailurePoint::None).unwrap();
    drop(conn);
}

// ---------------------------------------------------------------------------
// Brief Step 1 canonical tests
// ---------------------------------------------------------------------------

#[test]
fn supported_v4_migrates_to_v6_atomically() {
    let path = copy_fixture("v004.sqlite");
    migrate_supported(&path, 4, FailurePoint::None).unwrap();
    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 6);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert_seed_rows_preserved(&db);
}

#[test]
fn newer_too_old_and_invalid_are_byte_for_byte_unchanged() {
    for fixture in ["v002.sqlite", "v007.sqlite", "invalid-zero-byte.sqlite"] {
        let path = copy_fixture(fixture);
        let before = snapshot_file_and_sidecars(&path);
        assert!(inspect_schema(&path).is_rejected());
        assert_eq!(snapshot_file_and_sidecars(&path), before);
    }
}

// ---------------------------------------------------------------------------
// Fresh bootstrap
// ---------------------------------------------------------------------------

#[test]
fn fresh_bootstrap_creates_current_schema() {
    let path = fresh_path("fresh");
    assert_eq!(inspect_schema(&path), SchemaInspection::Fresh);
    bootstrap_current(&path, FailurePoint::None).unwrap();

    assert!(path.exists());
    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 6);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert_seed_rows_preserved(&db);
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

#[test]
fn fresh_bootstrap_rolls_back_atomically_on_any_statement_failure() {
    for version in 1..=6 {
        for index in 1..=32 {
            let path = fresh_path("boot-fail");
            match bootstrap_current(&path, FailurePoint::AfterStatement { version, index }) {
                Ok(()) => {
                    // Past the last statement of this migration: the whole
                    // bootstrap completed, so the published DB is schema 6.
                    let db = open_ro(&path);
                    assert_eq!(schema_version(&db), 6);
                    break;
                }
                Err(_) => {
                    assert!(
                        !path.exists(),
                        "bootstrap must never publish a partial database (v{version} stmt {index})"
                    );
                    for suffix in ["-journal", "-wal", "-shm"] {
                        let sidecar = PathBuf::from(format!("{}{}", path.display(), suffix));
                        assert!(
                            !sidecar.exists(),
                            "no sidecar may survive a failed bootstrap (v{version} stmt {index})"
                        );
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Supported older schemas
// ---------------------------------------------------------------------------

#[test]
fn supported_v3_migrates_to_v6() {
    let path = fresh_path("v3");
    build_schema3(&path);
    assert!(matches!(
        inspect_schema(&path),
        SchemaInspection::Older { version: 3 }
    ));

    migrate_supported(&path, 3, FailurePoint::None).unwrap();

    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 6);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert!(column_exists(&db, "category_types", "rollover_enabled"));
    assert_seed_rows_preserved(&db);
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

#[test]
fn migrated_current_schema_is_accepted_and_validates() {
    let path = copy_fixture("v004.sqlite");
    migrate_supported(&path, 4, FailurePoint::None).unwrap();

    let inspection = inspect_schema(&path);
    assert!(!inspection.is_rejected());
    assert_eq!(inspection.version(), Some(6));

    let db = open_ro(&path);
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

#[test]
fn version_specific_manifests_validate() {
    // The v4 fixture (migrations 1-4) matches the schema-4 manifest.
    let v4 = copy_fixture("v004.sqlite");
    let db = open_ro(&v4);
    validate_manifest(&db, 4).unwrap();
    drop(db);

    // A native migrations 1-3 build matches the schema-3 manifest.
    let v3 = fresh_path("v3-manifest");
    build_schema3(&v3);
    let db = open_ro(&v3);
    validate_manifest(&db, 3).unwrap();
    drop(db);

    // A native migrations 1-5 build matches the schema-5 manifest.
    let v5 = fresh_path("v5-manifest");
    {
        let mut conn = Connection::open(&v5).unwrap();
        run_migrations(&mut conn, 5, FailurePoint::None).unwrap();
        drop(conn);
    }
    let db = open_ro(&v5);
    validate_manifest(&db, 5).unwrap();
}

// ---------------------------------------------------------------------------
// Rejection paths
// ---------------------------------------------------------------------------

#[test]
fn inspect_schema_classifies_every_state() {
    assert_eq!(inspect_schema(&fresh_path("absent")), SchemaInspection::Fresh);

    let too_old = copy_fixture("v002.sqlite");
    assert!(matches!(
        inspect_schema(&too_old),
        SchemaInspection::TooOld { version: 2 }
    ));

    let older = copy_fixture("v004.sqlite");
    assert!(matches!(
        inspect_schema(&older),
        SchemaInspection::Older { version: 4 }
    ));

    let newer = copy_fixture("v007.sqlite");
    assert!(matches!(
        inspect_schema(&newer),
        SchemaInspection::Newer { version: 7 }
    ));

    let invalid = copy_fixture("invalid-zero-byte.sqlite");
    assert!(matches!(
        inspect_schema(&invalid),
        SchemaInspection::Invalid { .. }
    ));
}

#[test]
fn migrate_supported_rejects_unsupported_inputs() {
    assert_eq!(
        migrate_supported(&fresh_path("absent"), 4, FailurePoint::None).unwrap_err().code,
        notchy_lib::database::ErrorCode::DatabaseInvalid
    );
    assert_eq!(
        migrate_supported(&copy_fixture("v002.sqlite"), 2, FailurePoint::None).unwrap_err().code,
        notchy_lib::database::ErrorCode::DatabaseInvalid
    );
    assert_eq!(
        migrate_supported(&copy_fixture("v007.sqlite"), 7, FailurePoint::None).unwrap_err().code,
        notchy_lib::database::ErrorCode::DatabaseInvalid
    );
    assert_eq!(
        migrate_supported(&copy_fixture("invalid-zero-byte.sqlite"), 0, FailurePoint::None)
            .unwrap_err()
            .code,
        notchy_lib::database::ErrorCode::DatabaseInvalid
    );
    assert_eq!(
        migrate_supported(&copy_fixture("v004.sqlite"), 3, FailurePoint::None).unwrap_err().code,
        notchy_lib::database::ErrorCode::DatabaseInvalid
    );
}

// ---------------------------------------------------------------------------
// Failure injection after every statement of every migration
// ---------------------------------------------------------------------------

#[test]
fn every_migration_statement_rolls_back_atomically_for_v4() {
    // v4 fixture has migrations 5 and 6 pending.
    for version in [5, 6] {
        for index in 1..=32 {
            let path = copy_fixture("v004.sqlite");
            let before = snapshot_file_and_sidecars(&path);
            let result = migrate_supported(&path, 4, FailurePoint::AfterStatement { version, index });
            match result {
                Ok(()) => break,
                Err(_) => {
                    let db = open_ro(&path);
                    assert_eq!(
                        schema_version(&db),
                        version - 1,
                        "schema_version must equal the last committed migration (v{version} stmt {index})"
                    );
                    assert!(
                        !table_exists(&db, "operation_receipts"),
                        "operation_receipts must not exist (v{version} stmt {index})"
                    );
                    if version == 5 {
                        assert!(
                            !table_exists(&db, "categorize_rules"),
                            "categorize_rules must not exist (v{version} stmt {index})"
                        );
                        drop(db);
                        assert_eq!(
                            snapshot_file_and_sidecars(&path),
                            before,
                            "first pending migration failure must leave bytes unchanged (v{version} stmt {index})"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn every_migration_statement_rolls_back_atomically_for_v3() {
    // A schema-3 source: migrations 4, 5, and 6 are pending.
    let source = fresh_path("v3-source");
    build_schema3(&source);

    for version in [4, 5, 6] {
        for index in 1..=32 {
            let path = fresh_path("v3-copy");
            std::fs::copy(&source, &path).unwrap();
            let before = snapshot_file_and_sidecars(&path);
            let result = migrate_supported(&path, 3, FailurePoint::AfterStatement { version, index });
            match result {
                Ok(()) => break,
                Err(_) => {
                    let db = open_ro(&path);
                    assert_eq!(
                        schema_version(&db),
                        version - 1,
                        "schema_version must equal the last committed migration (v{version} stmt {index})"
                    );
                    assert!(
                        !table_exists(&db, "operation_receipts"),
                        "operation_receipts must not exist (v{version} stmt {index})"
                    );
                    if version == 4 {
                        assert!(
                            !column_exists(&db, "category_types", "rollover_enabled"),
                            "rollover_enabled must not exist (v{version} stmt {index})"
                        );
                        assert!(
                            !table_exists(&db, "categorize_rules"),
                            "categorize_rules must not exist (v{version} stmt {index})"
                        );
                        drop(db);
                        assert_eq!(
                            snapshot_file_and_sidecars(&path),
                            before,
                            "first pending migration failure must leave bytes unchanged (v{version} stmt {index})"
                        );
                    } else if version == 5 {
                        assert!(
                            column_exists(&db, "category_types", "rollover_enabled"),
                            "rollover_enabled commits with migration 4 (v{version} stmt {index})"
                        );
                        assert!(
                            !table_exists(&db, "categorize_rules"),
                            "categorize_rules must not exist (v{version} stmt {index})"
                        );
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

#[test]
fn schema_version_constants() {
    assert_eq!(LATEST_SCHEMA_VERSION, 6);
    assert_eq!(MIN_SUPPORTED_SCHEMA_VERSION, 3);
}
