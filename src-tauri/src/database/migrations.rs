//! Native schema registry, fresh bootstrap, and migrations 1-6 (Task 3).
//!
//! This is the single native source of schema truth: the exact SQL ported from
//! the committed TypeScript migration registry, plus the Rust-only migration
//! 006 that creates `operation_receipts`. Every migration and its schema-version
//! update run inside one `TransactionBehavior::Immediate` transaction, so any
//! failure rolls the whole migration back. A `FailurePoint` lets tests inject
//! an error after any statement and prove that atomicity.

use std::cell::Cell;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, Transaction, TransactionBehavior, params};

use crate::database::connection::{create_dir_private, open_live_at};
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::manifest::{inspect_schema, validate_manifest};
use crate::database::types::OperationId;

/// The newest released schema version.
pub const LATEST_SCHEMA_VERSION: i64 = 6;
/// The oldest schema version still supported for in-place migration.
pub const MIN_SUPPORTED_SCHEMA_VERSION: i64 = 3;

/// One migration: a version, a stable name, and the up function that applies it
/// against a transaction.
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: fn(&Transaction<'_>) -> DbResult<()>,
}

/// The ordered migration registry. Never reorder or renumber; every entry is
/// released schema history.
pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "initial", up: migration_001 },
    Migration { version: 2, name: "change_log_triggers", up: migration_002 },
    Migration { version: 3, name: "seed", up: migration_003 },
    Migration { version: 4, name: "rollover_toggle", up: migration_004 },
    Migration { version: 5, name: "categorize_rules", up: migration_005 },
    Migration { version: 6, name: "operation_receipts", up: migration_006 },
];

/// Fault-injection point for atomic-rollback tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailurePoint {
    /// Run without injected failure.
    None,
    /// Fail after the `index`-th statement (1-based, counting the schema-version
    /// bump) of the migration with `version`.
    AfterStatement { version: i64, index: usize },
}

thread_local! {
    static FAILPOINT: Cell<Option<FailurePoint>> = const { Cell::new(None) };
    static STMT_COUNT: Cell<usize> = const { Cell::new(0) };
}

/// Map a rusqlite error to the stable allowlisted envelope without leaking the
/// raw SQLite text or parameters.
fn sql<T>(result: rusqlite::Result<T>) -> DbResult<T> {
    result.map_err(map_sqlite_error)
}

/// Advance the per-migration statement counter and, when the running migration
/// reaches the injected failure point, return an error so the enclosing
/// transaction rolls back.
fn failpoint_step(version: i64) -> DbResult<()> {
    let target = FAILPOINT.with(Cell::get);
    let count = STMT_COUNT.with(|counter| {
        let next = counter.get() + 1;
        counter.set(next);
        next
    });
    if let Some(FailurePoint::AfterStatement { version: v, index }) = target {
        if v == version && index == count {
            return Err(DbError::new(ErrorCode::DatabaseCorrupt));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Registry driver
// ---------------------------------------------------------------------------

/// Apply every pending migration up to `target_version` (inclusive), each in
/// its own `TransactionBehavior::Immediate` transaction.
///
/// The connection's current version is read from `app_meta` (0 when absent).
/// `target_version` lets tests build intermediate schema states; production
/// bootstrap and migration both use `LATEST_SCHEMA_VERSION`.
pub fn run_migrations(
    connection: &mut Connection,
    target_version: i64,
    failure_point: FailurePoint,
) -> DbResult<()> {
    FAILPOINT.with(|slot| slot.set(Some(failure_point)));

    // `app_meta` is created by the migration runner before any migration runs,
    // mirroring the frontend runner exactly.
    sql(connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    ))?;

    let current = read_schema_version(connection)?;
    if current > LATEST_SCHEMA_VERSION {
        return Err(
            DbError::new(ErrorCode::SchemaTooNew).with_meta("schema_version", current.to_string())
        );
    }

    for migration in MIGRATIONS {
        if migration.version <= current {
            continue;
        }
        if migration.version > target_version {
            break;
        }
        STMT_COUNT.with(|counter| counter.set(0));

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(map_sqlite_error)?;
        (migration.up)(&transaction)?;
        sql(transaction.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?1)",
            params![migration.version.to_string()],
        ))?;
        // The schema-version bump is part of the same transaction and counts as
        // a statement so failure after it also rolls back atomically.
        failpoint_step(migration.version)?;
        transaction.commit().map_err(map_sqlite_error)?;
    }
    Ok(())
}

/// Migrate a supported-older database at `path` to the latest schema.
///
/// The database is inspected read-only first; only `Older` schemas with the
/// expected `from_version` proceed. The live connection applies the exact
/// connection policy, every pending migration runs atomically, and the result
/// is validated against the schema-6 manifest.
pub fn migrate_supported(
    path: &Path,
    from_version: i64,
    failure_point: FailurePoint,
) -> DbResult<()> {
    let actual = match inspect_schema(path) {
        crate::database::manifest::SchemaInspection::Older { version } => version,
        _ => return Err(DbError::new(ErrorCode::DatabaseInvalid)),
    };
    if actual != from_version {
        return Err(DbError::new(ErrorCode::DatabaseInvalid));
    }

    let mut connection = open_live_at(path)?;
    run_migrations(&mut connection, LATEST_SCHEMA_VERSION, failure_point)?;
    validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;
    Ok(())
}

/// Bootstrap a fresh database (absent path) through migrations 1-6.
///
/// The schema is built in a same-directory temporary file, validated, `fsync`ed,
/// and atomically renamed into place, then the directory is `fsync`ed. Any
/// failure discards the temporary file and its sidecars, so a partial database
/// is never published.
pub fn bootstrap_current(path: &Path, failure_point: FailurePoint) -> DbResult<()> {
    if path.exists() {
        return Err(DbError::new(ErrorCode::DatabaseInvalid));
    }
    let parent = path
        .parent()
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    create_dir_private(parent).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

    let temp_path = parent.join(format!(
        ".notchy-bootstrap-{}.tmp",
        OperationId::generate().as_str()
    ));

    let result = (|| -> DbResult<()> {
        let mut connection = open_live_at(&temp_path)?;
        run_migrations(&mut connection, LATEST_SCHEMA_VERSION, failure_point)?;
        validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;
        drop(connection);

        let file = OpenOptions::new()
            .write(true)
            .open(&temp_path)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        file.sync_all()
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        drop(file);

        std::fs::rename(&temp_path, path)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

        let directory = std::fs::File::open(parent)
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        directory
            .sync_all()
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
        for suffix in ["-journal", "-wal", "-shm"] {
            let sidecar = PathBuf::from(format!("{}{}", temp_path.display(), suffix));
            let _ = std::fs::remove_file(sidecar);
        }
    }
    result
}

fn read_schema_version(connection: &Connection) -> DbResult<i64> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
        .map_err(map_sqlite_error)?;
    match value {
        None => Ok(0),
        Some(value) => value
            .parse::<i64>()
            .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid)),
    }
}

// ---------------------------------------------------------------------------
// Migration 1: initial schema (ported from 001_initial.ts)
// ---------------------------------------------------------------------------

fn migration_001(transaction: &Transaction<'_>) -> DbResult<()> {
    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS accounts (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL CHECK (length(name) <= 64),
            type         TEXT NOT NULL CHECK (type IN (
                           'checking', 'savings', 'cash', 'credit_card',
                           'loan_to_person', 'loan_from_person'
                         )),
            counterparty TEXT CHECK (counterparty IS NULL OR length(counterparty) <= 64),
            currency     TEXT NOT NULL DEFAULT 'VND',
            archived     INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            deleted_at   TEXT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS category_types (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL CHECK (length(name) <= 64),
            is_system  INTEGER NOT NULL DEFAULT 0,
            budgetable INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS category_tags (
            id         TEXT PRIMARY KEY,
            type_id    TEXT NOT NULL REFERENCES category_types(id),
            name       TEXT NOT NULL CHECK (length(name) <= 64),
            is_system  INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            UNIQUE(type_id, name) ON CONFLICT ABORT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS transactions (
            id                  TEXT PRIMARY KEY,
            kind                TEXT NOT NULL CHECK (kind IN (
                                  'expense', 'income', 'transfer', 'refund', 'adjustment'
                                )),
            date                TEXT NOT NULL CHECK (date BETWEEN '1970-01-01' AND '2100-12-31'),
            amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
            account_id          TEXT NOT NULL REFERENCES accounts(id),
            transfer_account_id TEXT REFERENCES accounts(id),
            transfer_pair_id    TEXT,
            refund_of_id        TEXT REFERENCES transactions(id),
            tag_id              TEXT REFERENCES category_tags(id),
            payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
            description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
            created_at          TEXT NOT NULL,
            updated_at          TEXT NOT NULL,
            deleted_at          TEXT,
            CHECK (
                (kind = 'transfer' AND transfer_account_id IS NOT NULL AND transfer_pair_id IS NOT NULL AND tag_id IS NULL AND refund_of_id IS NULL)
                OR (kind = 'refund' AND transfer_account_id IS NULL AND transfer_pair_id IS NULL)
                OR (kind IN ('expense', 'income', 'adjustment') AND transfer_account_id IS NULL AND transfer_pair_id IS NULL AND refund_of_id IS NULL)
            )
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS budgets (
            id         TEXT PRIMARY KEY,
            type_id    TEXT NOT NULL REFERENCES category_types(id),
            month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
            allocated  INTEGER NOT NULL CHECK (allocated >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            UNIQUE(type_id, month)
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS goals (
            id                TEXT PRIMARY KEY,
            name              TEXT NOT NULL CHECK (length(name) <= 64),
            type              TEXT NOT NULL CHECK (type IN ('savings', 'debt_payoff', 'net_worth')),
            target_amount     INTEGER NOT NULL CHECK (target_amount > 0),
            target_date       TEXT NOT NULL,
            linked_account_id TEXT REFERENCES accounts(id),
            starting_amount   INTEGER NOT NULL,
            show_on_dashboard INTEGER NOT NULL DEFAULT 1,
            status            TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'completed', 'abandoned', 'overdue')),
            closed_at         TEXT,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL,
            deleted_at        TEXT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS reconciliations (
            id                        TEXT PRIMARY KEY,
            account_id                TEXT NOT NULL REFERENCES accounts(id),
            date                      TEXT NOT NULL,
            expected_balance          INTEGER NOT NULL,
            actual_balance            INTEGER NOT NULL,
            adjustment_transaction_id TEXT REFERENCES transactions(id),
            notes                     TEXT,
            created_at                TEXT NOT NULL,
            updated_at                TEXT NOT NULL,
            deleted_at                TEXT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS change_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            row_id     TEXT NOT NULL,
            operation  TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
            timestamp  TEXT NOT NULL,
            device_id  TEXT NOT NULL,
            payload    TEXT
        )",
        [],
    ))?;
    failpoint_step(1)?;

    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type) WHERE deleted_at IS NULL",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_accounts_archived ON accounts(archived) WHERE deleted_at IS NULL",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_tag ON transactions(tag_id)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_payee ON transactions(payee)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_kind_date ON transactions(kind, date)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_pair ON transactions(transfer_pair_id)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_refund ON transactions(refund_of_id)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NOT NULL",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status) WHERE deleted_at IS NULL",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_reconciliations_account ON reconciliations(account_id, date)",
        [],
    ))?;
    failpoint_step(1)?;
    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_change_log_timestamp ON change_log(timestamp)",
        [],
    ))?;
    failpoint_step(1)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Migration 2: change-log triggers (ported from 002_triggers.ts)
// ---------------------------------------------------------------------------

const DATA_TABLES: &[(&str, &[&str])] = &[
    (
        "accounts",
        &[
            "id", "name", "type", "counterparty", "currency", "archived", "created_at",
            "updated_at", "deleted_at",
        ],
    ),
    (
        "category_types",
        &[
            "id", "name", "is_system", "budgetable", "sort_order", "created_at", "updated_at",
            "deleted_at",
        ],
    ),
    (
        "category_tags",
        &[
            "id", "type_id", "name", "is_system", "sort_order", "created_at", "updated_at",
            "deleted_at",
        ],
    ),
    (
        "transactions",
        &[
            "id", "kind", "date", "amount", "account_id", "transfer_account_id",
            "transfer_pair_id", "refund_of_id", "tag_id", "payee", "description", "created_at",
            "updated_at", "deleted_at",
        ],
    ),
    (
        "budgets",
        &[
            "id", "type_id", "month", "allocated", "created_at", "updated_at", "deleted_at",
        ],
    ),
    (
        "goals",
        &[
            "id", "name", "type", "target_amount", "target_date", "linked_account_id",
            "starting_amount", "show_on_dashboard", "status", "closed_at", "created_at",
            "updated_at", "deleted_at",
        ],
    ),
    (
        "reconciliations",
        &[
            "id", "account_id", "date", "expected_balance", "actual_balance",
            "adjustment_transaction_id", "notes", "created_at", "updated_at", "deleted_at",
        ],
    ),
];

fn json_object_expr(prefix: &str, columns: &[&str]) -> String {
    let parts: Vec<String> = columns
        .iter()
        .map(|column| format!("'{column}', {prefix}.{column}"))
        .collect();
    format!("json_object({})", parts.join(", "))
}

fn migration_002(transaction: &Transaction<'_>) -> DbResult<()> {
    for (table, columns) in DATA_TABLES {
        let payload_new = json_object_expr("NEW", columns);
        let payload_old = json_object_expr("OLD", columns);

        let insert_sql = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_insert AFTER INSERT ON {table}
            BEGIN
                INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
                VALUES (
                    '{table}', NEW.id, 'insert',
                    NEW.updated_at,
                    (SELECT value FROM app_meta WHERE key = 'device_id'),
                    {payload_new}
                );
            END"
        );
        sql(transaction.execute(&insert_sql, []))?;
        failpoint_step(2)?;

        let update_sql = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_update AFTER UPDATE ON {table}
            BEGIN
                INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
                VALUES (
                    '{table}', NEW.id, 'update',
                    NEW.updated_at,
                    (SELECT value FROM app_meta WHERE key = 'device_id'),
                    {payload_new}
                );
            END"
        );
        sql(transaction.execute(&update_sql, []))?;
        failpoint_step(2)?;

        let delete_sql = format!(
            "CREATE TRIGGER IF NOT EXISTS trg_{table}_delete AFTER DELETE ON {table}
            BEGIN
                INSERT INTO change_log (table_name, row_id, operation, timestamp, device_id, payload)
                VALUES (
                    '{table}', OLD.id, 'delete',
                    OLD.updated_at,
                    (SELECT value FROM app_meta WHERE key = 'device_id'),
                    {payload_old}
                );
            END"
        );
        sql(transaction.execute(&delete_sql, []))?;
        failpoint_step(2)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Migration 3: seed data (ported from 003_seed.ts)
// ---------------------------------------------------------------------------

fn migration_003(transaction: &Transaction<'_>) -> DbResult<()> {
    let device_id = OperationId::generate().as_str().to_string();
    sql(transaction.execute(
        "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('device_id', ?1)",
        params![device_id],
    ))?;
    failpoint_step(3)?;

    let now = now_iso_utc();

    let buckets = [
        ("bucket_essentials", "Essentials", 1, 0),
        ("bucket_learning", "Learning & Entertainment", 1, 1),
        ("bucket_saving", "Saving & Investment", 1, 2),
        ("bucket_adjustments", "Adjustments", 0, 3),
    ];
    for (id, name, budgetable, sort_order) in buckets {
        sql(transaction.execute(
            "INSERT OR IGNORE INTO category_types (id, name, is_system, budgetable, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, name, 0, budgetable, sort_order, now, now],
        ))?;
        failpoint_step(3)?;
    }

    let tags = [
        ("tag_initial_balance", "bucket_adjustments", "Initial Balance"),
        ("tag_loss", "bucket_adjustments", "Loss"),
        ("tag_gift", "bucket_adjustments", "Gift"),
        ("tag_reconciliation", "bucket_adjustments", "Reconciliation"),
    ];
    for (id, type_id, name) in tags {
        sql(transaction.execute(
            "INSERT OR IGNORE INTO category_tags (id, type_id, name, is_system, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 0, ?4, ?5)",
            params![id, type_id, name, now, now],
        ))?;
        failpoint_step(3)?;
    }

    Ok(())
}

/// Current UTC time as an ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SSZ`).
fn now_iso_utc() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = seconds / 86_400;
    let seconds_of_day = seconds % 86_400;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Convert days since the Unix epoch to a (year, month, day) civil date using
/// Howard Hinnant's `civil_from_days` algorithm.
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

// ---------------------------------------------------------------------------
// Migration 4: rollover toggle (ported from 004_rollover_toggle.ts)
// ---------------------------------------------------------------------------

fn migration_004(transaction: &Transaction<'_>) -> DbResult<()> {
    // SQLite has no ADD COLUMN IF NOT EXISTS; guard against a half-applied
    // state by checking PRAGMA table_info first (same as the TS migration).
    let has_rollover = {
        let mut stmt = transaction
            .prepare("PRAGMA table_info(category_types)")
            .map_err(map_sqlite_error)?;
        let mut rows = stmt.query([]).map_err(map_sqlite_error)?;
        let mut found = false;
        while let Some(row) = rows.next().map_err(map_sqlite_error)? {
            let name: String = row.get(1).map_err(map_sqlite_error)?;
            if name == "rollover_enabled" {
                found = true;
            }
        }
        found
    };
    if has_rollover {
        return Ok(());
    }

    sql(transaction.execute(
        "ALTER TABLE category_types ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 1",
        [],
    ))?;
    failpoint_step(4)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Migration 5: categorize rules (ported from 005_categorize_rules.ts)
// ---------------------------------------------------------------------------

fn migration_005(transaction: &Transaction<'_>) -> DbResult<()> {
    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS categorize_rules (
            id          TEXT PRIMARY KEY,
            payee_term  TEXT NOT NULL CHECK (length(payee_term) BETWEEN 1 AND 128),
            match_mode  TEXT NOT NULL CHECK (match_mode IN ('is', 'starts_with', 'contains')),
            tag_id      TEXT NOT NULL REFERENCES category_tags(id),
            source      TEXT NOT NULL DEFAULT 'manual'
                           CHECK (source IN ('manual', 'learned')),
            enabled     INTEGER NOT NULL DEFAULT 1,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            deleted_at  TEXT
        )",
        [],
    ))?;
    failpoint_step(5)?;

    sql(transaction.execute(
        "CREATE INDEX IF NOT EXISTS idx_categorize_rules_enabled
         ON categorize_rules(enabled, deleted_at)",
        [],
    ))?;
    failpoint_step(5)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Migration 6: idempotency receipts (Rust-only, new in schema 6)
// ---------------------------------------------------------------------------

fn migration_006(transaction: &Transaction<'_>) -> DbResult<()> {
    sql(transaction.execute(
        "CREATE TABLE IF NOT EXISTS operation_receipts (
            operation_id TEXT PRIMARY KEY,
            command_kind TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            result_json  TEXT NOT NULL,
            completed_at TEXT NOT NULL
        )",
        [],
    ))?;
    failpoint_step(6)?;
    Ok(())
}
