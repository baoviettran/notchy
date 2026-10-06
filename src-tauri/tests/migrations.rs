//! Integration tests for the native schema manifests, fresh bootstrap, and the
//! migrations 1-7 registry (Task 3).
//!
//! Covers: fresh bootstrap, supported v3 and v4 -> v7 migration, current
//! schema acceptance, too-old / newer / invalid read-only rejection with
//! byte-for-byte non-mutation, and failure injection after every statement of
//! every migration proving full atomic rollback.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::accounts;
use notchy_lib::database::types::{AccountType, NewAccount, OperationId};
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

/// The migration-003 seed buckets and tags must survive any migration to 6
/// with exactly the business-relevant seed columns the TS source seeds:
/// `(is_system, budgetable, sort_order)` for buckets and
/// `(is_system, sort_order, type_id)` for tags. Only the Adjustments bucket is
/// a system bucket; the rest are user buckets.
fn assert_seed_rows_preserved(db: &Connection) {
    let buckets: [(&str, i64, i64, i64); 4] = [
        ("bucket_essentials", 0, 1, 0),
        ("bucket_learning", 0, 1, 1),
        ("bucket_saving", 0, 1, 2),
        ("bucket_adjustments", 1, 0, 3),
    ];
    for (id, is_system, budgetable, sort_order) in buckets {
        let (count, actual_is_system, actual_budgetable, actual_sort_order): (i64, i64, i64, i64) = db
            .query_row(
                "SELECT COUNT(*), is_system, budgetable, sort_order FROM category_types WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(count, 1, "seed bucket {id} must survive migration");
        assert_eq!(
            actual_is_system, is_system,
            "seed bucket {id} must keep its is_system flag"
        );
        assert_eq!(
            actual_budgetable, budgetable,
            "seed bucket {id} must keep its budgetable flag"
        );
        assert_eq!(
            actual_sort_order, sort_order,
            "seed bucket {id} must keep its sort_order"
        );
    }
    let tags: [(&str, i64, i64); 4] = [
        ("tag_initial_balance", 1, 0),
        ("tag_loss", 1, 0),
        ("tag_gift", 1, 0),
        ("tag_reconciliation", 1, 0),
    ];
    for (id, is_system, sort_order) in tags {
        let (count, actual_is_system, actual_sort_order, actual_type_id): (i64, i64, i64, String) = db
            .query_row(
                "SELECT COUNT(*), is_system, sort_order, type_id FROM category_tags WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(count, 1, "seed tag {id} must survive migration");
        assert_eq!(
            actual_is_system, is_system,
            "seed tag {id} must keep its is_system flag"
        );
        assert_eq!(
            actual_sort_order, sort_order,
            "seed tag {id} must keep its sort_order"
        );
        assert_eq!(
            actual_type_id, "bucket_adjustments",
            "seed tag {id} must keep its type_id"
        );
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

fn op() -> OperationId {
    OperationId::generate()
}

fn account_named(name: &str) -> NewAccount {
    NewAccount {
        name: name.to_string(),
        account_type: AccountType::Checking,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: None,
        initial_balance_date: None,
    }
}

/// A freshly bootstrapped schema-7 database, read-only for inspection.
fn fresh_schema7_db() -> Connection {
    let path = fresh_path("schema7");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    open_ro(&path)
}

/// A freshly bootstrapped schema-7 database, **read-write**, with one account
/// row inserted.
///
/// Read-write is mandatory: an `INSERT` through `open_ro` fails with "attempt to
/// write a readonly database" for *every* input, so every rejection test below
/// would pass with the CHECKs deleted. The real account row is the second half
/// of the same defence — a bare `rusqlite::Connection` leaves `foreign_keys`
/// off, so a bogus `account_id` would not be caught, but inserting a real one
/// keeps each rejection attributable to the CHECK the test names under either
/// pragma.
fn fresh_schema7_db_with_account() -> (Connection, String) {
    let path = fresh_path("schema7-rw");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    let mut conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    let account_id = accounts::create_account(&mut conn, op(), account_named("Main")).unwrap();
    (conn, account_id)
}

// ---------------------------------------------------------------------------
// Brief Step 1 canonical tests
// ---------------------------------------------------------------------------

#[test]
fn supported_v4_migrates_to_v7_atomically() {
    let path = copy_fixture("v004.sqlite");
    migrate_supported(&path, 4, FailurePoint::None).unwrap();
    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 7);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert!(table_exists(&db, "schedules"));
    assert_seed_rows_preserved(&db);
}

#[test]
fn newer_too_old_and_invalid_are_byte_for_byte_unchanged() {
    for fixture in ["v002.sqlite", "v008.sqlite", "invalid-zero-byte.sqlite"] {
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
    assert_eq!(schema_version(&db), 7);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert!(table_exists(&db, "schedules"));
    assert_seed_rows_preserved(&db);
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

#[test]
fn fresh_bootstrap_rolls_back_atomically_on_any_statement_failure() {
    for version in 1..=7 {
        for index in 1..=32 {
            let path = fresh_path("boot-fail");
            match bootstrap_current(&path, FailurePoint::AfterStatement { version, index }) {
                Ok(()) => {
                    // Past the last statement of this migration: the whole
                    // bootstrap completed, so the published DB is schema 7.
                    let db = open_ro(&path);
                    assert_eq!(schema_version(&db), 7);
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
fn supported_v3_migrates_to_v7() {
    let path = fresh_path("v3");
    build_schema3(&path);
    assert!(matches!(
        inspect_schema(&path),
        SchemaInspection::Older { version: 3 }
    ));

    migrate_supported(&path, 3, FailurePoint::None).unwrap();

    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 7);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert!(table_exists(&db, "schedules"));
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
    assert_eq!(inspection.version(), Some(7));

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

    let newer = copy_fixture("v008.sqlite");
    assert!(matches!(
        inspect_schema(&newer),
        SchemaInspection::Newer { version: 8 }
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
        migrate_supported(&copy_fixture("v008.sqlite"), 8, FailurePoint::None).unwrap_err().code,
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
    // v4 fixture has migrations 5, 6, and 7 pending.
    for version in [5, 6, 7] {
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
                    // A table introduced by the failing migration or any later
                    // one must be absent; an earlier migration's tables commit.
                    if version <= 6 {
                        assert!(
                            !table_exists(&db, "operation_receipts"),
                            "operation_receipts must not exist (v{version} stmt {index})"
                        );
                    }
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
                    } else if version == 7 {
                        assert!(
                            table_exists(&db, "operation_receipts"),
                            "operation_receipts commits with migration 6 (v{version} stmt {index})"
                        );
                        assert!(
                            !table_exists(&db, "schedules"),
                            "schedules must not exist (v{version} stmt {index})"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn every_migration_statement_rolls_back_atomically_for_v3() {
    // A schema-3 source: migrations 4, 5, 6, and 7 are pending.
    let source = fresh_path("v3-source");
    build_schema3(&source);

    for version in [4, 5, 6, 7] {
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
                    if version <= 6 {
                        assert!(
                            !table_exists(&db, "operation_receipts"),
                            "operation_receipts must not exist (v{version} stmt {index})"
                        );
                    }
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
                    } else if version == 7 {
                        assert!(
                            table_exists(&db, "operation_receipts"),
                            "operation_receipts commits with migration 6 (v{version} stmt {index})"
                        );
                        assert!(
                            !table_exists(&db, "schedules"),
                            "schedules must not exist (v{version} stmt {index})"
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

// The `LATEST_SCHEMA_VERSION` / `MIN_SUPPORTED_SCHEMA_VERSION` assertions live
// in `the_v7_manifest_is_the_latest_one` below, next to the manifest they
// describe — one test per constant, not two restating the same pair.

#[test]
fn the_money_bound_matches_the_migration_check() {
    let path = fresh_path("money-bound");
    bootstrap_current(&path, FailurePoint::None).unwrap();
    let conn = Connection::open(&path).unwrap();

    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'transactions'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // The bound is read out of the migration that encodes it, so a migration
    // that changes the cap and a constant that does not cannot both be green.
    let expected = format!("amount <= {}", notchy_lib::database::error::MAX_AMOUNT);
    assert!(
        ddl.contains(&expected),
        "transactions DDL no longer carries `{expected}`:\n{ddl}"
    );
}

// ---------------------------------------------------------------------------
// Migration 7 (schedules)
// ---------------------------------------------------------------------------

#[test]
fn migration_seven_creates_the_schedules_table() {
    let db = fresh_schema7_db();
    let columns: Vec<String> = db
        .prepare("PRAGMA table_info(schedules)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(columns.iter().any(|name| name == "next_due_date"));
    assert!(columns.iter().any(|name| name == "errored_at"));
    assert!(columns.iter().any(|name| name == "transfer_account_id"));
}

#[test]
fn the_v7_manifest_is_the_latest_one() {
    assert_eq!(LATEST_SCHEMA_VERSION, 7);
    assert_eq!(MIN_SUPPORTED_SCHEMA_VERSION, 3);
    // A database at 7 validates against the manifest for 7 — the startup gate.
    let db = fresh_schema7_db();
    validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
}

/// Every rejection test below inserts through a read-write connection holding a
/// real `accounts` row, and asserts on the SQLite error text rather than on
/// "some error". Both halves matter: `open_ro` would fail every INSERT with
/// "attempt to write a readonly database", and a dangling `account_id` would
/// (under `PRAGMA foreign_keys = ON`, which production sets) fail on the
/// foreign key before the CHECK under test is ever reached.
#[test]
fn migration_seven_rejects_an_unknown_frequency() {
    let (db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'expense', 100, ?1, 'fortnightly', '2026-01-01', '2026-01-01', 'x', 'x')",
            [account_id],
        )
        .expect_err("the frequency CHECK must be authoritative on the native path too");
    // Attribute the failure to the named constraint, not to "something rejected it".
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("frequency"),
        "expected the frequency CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_rejects_an_out_of_range_start_date() {
    let (db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'expense', 100, ?1, 'monthly', '1899-12-31', '1899-12-31', 'x', 'x')",
            [account_id],
        )
        .expect_err("the date bound must match transactions.date and the JS side");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("start_date"),
        "expected the start_date CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_rejects_a_transfer_without_a_destination() {
    let (db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, transfer_account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'transfer', 100, ?1, NULL, 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')",
            [account_id],
        )
        .expect_err("a transfer must name a destination account");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed")
            && message.contains("transfer_account_id IS NOT NULL"),
        "expected the transfer-requires-destination CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_rejects_an_expense_with_a_destination() {
    let (db, account_id) = fresh_schema7_db_with_account();
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, transfer_account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'expense', 100, ?1, ?2, 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')",
            rusqlite::params![account_id, account_id],
        )
        .expect_err("only a transfer may carry a destination account");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed")
            && message.contains("kind = 'transfer' OR transfer_account_id IS NULL"),
        "expected the non-transfer-has-no-destination CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_rejects_a_transfer_with_a_tag() {
    let (db, account_id) = fresh_schema7_db_with_account();
    let tag_id = seed_tag_id(&db);
    let error = db
        .execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, transfer_account_id, tag_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES ('s1', 'Rent', 'transfer', 100, ?1, ?1, ?2, 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')",
            rusqlite::params![account_id, tag_id],
        )
        .expect_err("a posted transfer posts no transaction, so it can carry no tag");
    let message = error.to_string();
    assert!(
        message.contains("CHECK constraint failed") && message.contains("tag_id IS NULL"),
        "expected the transfer-carries-no-tag CHECK, got: {message}"
    );
}

#[test]
fn migration_seven_accepts_a_well_formed_expense_and_transfer() {
    // The other half of the contract: a row that satisfies every CHECK must be
    // storable. Without this, an over-tightened CHECK passes every rejection
    // test above. The transfer case is what proves both `kind` CHECKs are right
    // rather than merely present.
    let (mut db, account_id) = fresh_schema7_db_with_account();
    let transfer_id = accounts::create_account(&mut db, op(), account_named("Dest")).unwrap();

    for (id, kind, destination) in [
        ("ok-expense", "expense", None),
        ("ok-transfer", "transfer", Some(&transfer_id)),
    ] {
        db.execute(
            "INSERT INTO schedules (id, name, kind, amount, account_id, transfer_account_id, frequency, start_date, next_due_date, created_at, updated_at)
             VALUES (?1, 'Rent', ?2, 100, ?3, ?4, 'monthly', '2026-01-01', '2026-01-01', 'x', 'x')",
            rusqlite::params![id, kind, account_id, destination],
        )
        .unwrap_or_else(|e| panic!("{kind} schedule {id} must be accepted, got: {e}"));

        let stored: String = db
            .query_row("SELECT kind FROM schedules WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(stored, kind, "schedule {id} must round-trip its kind");
    }
}

/// A real `category_tags` row, so a rejection test can never be attributed to a
/// dangling `tag_id` instead of the CHECK it names.
fn seed_tag_id(db: &Connection) -> String {
    let id: String = db
        .query_row(
            "SELECT id FROM category_tags WHERE type_id = 'bucket_adjustments' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("migration 3 seeds the Adjustments bucket's tags");
    id
}
