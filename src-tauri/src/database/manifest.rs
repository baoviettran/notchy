//! Version-specific schema manifests and validation (Task 3).
//!
//! Each supported schema version (3-6) has an exact manifest covering tables,
//! columns, types, nullability, defaults, primary/foreign keys, indexes,
//! triggers, and the CHECK constraints that carry business invariants.
//! `validate_manifest` runs SQLite integrity and foreign-key checks and then
//! compares every structural element against the version's manifest. Rejected
//! databases are never opened live, so validation is always read-only until
//! schema acceptance.

use std::path::Path;

use crate::database::connection::open_read_only_at;
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::{LATEST_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION};

// ---------------------------------------------------------------------------
// Manifest model
// ---------------------------------------------------------------------------

/// One expected column: name, declared type, nullability, default expression,
/// and whether it is part of the primary key.
pub struct ColumnManifest {
    pub name: &'static str,
    pub r#type: &'static str,
    pub not_null: bool,
    pub default: Option<&'static str>,
    pub primary_key: bool,
}

/// One expected foreign key declared on a table's column.
pub struct ForeignKeyManifest {
    pub column: &'static str,
    pub references_table: &'static str,
    pub references_column: &'static str,
}

/// One expected table: its columns, foreign keys, indexes, triggers, and the
/// CHECK expressions that carry business invariants.
pub struct TableManifest {
    pub name: &'static str,
    pub columns: &'static [ColumnManifest],
    pub foreign_keys: &'static [ForeignKeyManifest],
    pub indexes: &'static [&'static str],
    pub triggers: &'static [&'static str],
    pub check_constraints: &'static [&'static str],
}

/// The complete expected state of a database at one released schema version.
pub struct SchemaManifest {
    pub version: i64,
    pub tables: &'static [TableManifest],
}

/// Classification of an existing database path before any live open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SchemaInspection {
    /// The path is absent; a fresh bootstrap is allowed.
    Fresh,
    /// A released, older supported schema (MIN_SUPPORTED..LATEST); migrates.
    Older { version: i64 },
    /// The current schema; nothing to do.
    Current { version: i64 },
    /// Too old to migrate; rejected read-only.
    TooOld { version: i64 },
    /// Written by a newer app; rejected read-only.
    Newer { version: i64 },
    /// Not a usable Notchy database; rejected read-only.
    Invalid { reason: InvalidSchemaReason },
}

/// Why an existing path is invalid rather than fresh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidSchemaReason {
    /// The file exists (zero-byte, partial, or non-Notchy) but no schema
    /// version is recorded.
    MissingSchemaVersion,
    /// The recorded schema version is not a positive integer.
    InvalidSchemaVersion,
}

impl SchemaInspection {
    /// True when the path must be rejected without any byte or sidecar
    /// mutation: too-old, newer, and invalid databases.
    pub fn is_rejected(&self) -> bool {
        matches!(
            self,
            SchemaInspection::TooOld { .. }
                | SchemaInspection::Newer { .. }
                | SchemaInspection::Invalid { .. }
        )
    }

    /// The recorded schema version for `Older`, `Current`, `TooOld`, and
    /// `Newer`; `None` for fresh and invalid paths.
    pub fn version(&self) -> Option<i64> {
        match self {
            SchemaInspection::Older { version }
            | SchemaInspection::Current { version }
            | SchemaInspection::TooOld { version }
            | SchemaInspection::Newer { version } => Some(*version),
            SchemaInspection::Fresh | SchemaInspection::Invalid { .. } => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const TEXT: &str = "TEXT";
const INTEGER: &str = "INTEGER";

macro_rules! column {
    ($name:expr, $type:expr, $not_null:expr, $default:expr, $pk:expr) => {
        ColumnManifest {
            name: $name,
            r#type: $type,
            not_null: $not_null,
            default: $default,
            primary_key: $pk,
        }
    };
}

/// `TEXT PRIMARY KEY` (no explicit default).
///
/// `PRAGMA table_info` reports `notnull=0` for primary-key columns unless an
/// explicit `NOT NULL` is declared, so `not_null` stays `false` to match.
macro_rules! text_pk {
    ($name:expr) => {
        column!($name, TEXT, false, None, true)
    };
}

/// `TEXT NOT NULL`.
macro_rules! text_nn {
    ($name:expr) => {
        column!($name, TEXT, true, None, false)
    };
}

/// Nullable `TEXT`.
macro_rules! text_opt {
    ($name:expr) => {
        column!($name, TEXT, false, None, false)
    };
}

/// `INTEGER NOT NULL DEFAULT <expr>`.
macro_rules! int_default {
    ($name:expr, $default:expr) => {
        column!($name, INTEGER, true, Some($default), false)
    };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const ACCOUNTS: TableManifest = TableManifest {
    name: "accounts",
    columns: &[
        text_pk!("id"),
        text_nn!("name"),
        text_nn!("type"),
        text_opt!("counterparty"),
        column!("currency", TEXT, true, Some("'VND'"), false),
        int_default!("archived", "0"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[],
    indexes: &["idx_accounts_type", "idx_accounts_archived"],
    triggers: &[
        "trg_accounts_insert",
        "trg_accounts_update",
        "trg_accounts_delete",
    ],
    check_constraints: &[
        "length(name) <= 64",
        "type IN ('checking', 'savings', 'cash', 'credit_card', 'loan_to_person', 'loan_from_person')",
        "counterparty IS NULL OR length(counterparty) <= 64",
    ],
};

const CATEGORY_TYPES_V3: TableManifest = TableManifest {
    name: "category_types",
    columns: &[
        text_pk!("id"),
        text_nn!("name"),
        int_default!("is_system", "0"),
        int_default!("budgetable", "1"),
        int_default!("sort_order", "0"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[],
    indexes: &[],
    triggers: &[
        "trg_category_types_insert",
        "trg_category_types_update",
        "trg_category_types_delete",
    ],
    check_constraints: &["length(name) <= 64"],
};

const CATEGORY_TYPES_V4: TableManifest = TableManifest {
    name: "category_types",
    columns: &[
        text_pk!("id"),
        text_nn!("name"),
        int_default!("is_system", "0"),
        int_default!("budgetable", "1"),
        int_default!("sort_order", "0"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
        // migration 4 is an ALTER TABLE ADD COLUMN, which appends the column
        // after every original column.
        int_default!("rollover_enabled", "1"),
    ],
    foreign_keys: &[],
    indexes: &[],
    triggers: &[
        "trg_category_types_insert",
        "trg_category_types_update",
        "trg_category_types_delete",
    ],
    check_constraints: &["length(name) <= 64"],
};

const CATEGORY_TAGS: TableManifest = TableManifest {
    name: "category_tags",
    columns: &[
        text_pk!("id"),
        text_nn!("type_id"),
        text_nn!("name"),
        int_default!("is_system", "0"),
        int_default!("sort_order", "0"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[ForeignKeyManifest {
        column: "type_id",
        references_table: "category_types",
        references_column: "id",
    }],
    indexes: &[],
    triggers: &[
        "trg_category_tags_insert",
        "trg_category_tags_update",
        "trg_category_tags_delete",
    ],
    check_constraints: &["length(name) <= 64"],
};

const TRANSACTIONS: TableManifest = TableManifest {
    name: "transactions",
    columns: &[
        text_pk!("id"),
        text_nn!("kind"),
        text_nn!("date"),
        column!("amount", INTEGER, true, None, false),
        text_nn!("account_id"),
        text_opt!("transfer_account_id"),
        text_opt!("transfer_pair_id"),
        text_opt!("refund_of_id"),
        text_opt!("tag_id"),
        text_opt!("payee"),
        text_opt!("description"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[
        ForeignKeyManifest {
            column: "account_id",
            references_table: "accounts",
            references_column: "id",
        },
        ForeignKeyManifest {
            column: "transfer_account_id",
            references_table: "accounts",
            references_column: "id",
        },
        ForeignKeyManifest {
            column: "refund_of_id",
            references_table: "transactions",
            references_column: "id",
        },
        ForeignKeyManifest {
            column: "tag_id",
            references_table: "category_tags",
            references_column: "id",
        },
    ],
    indexes: &[
        "idx_transactions_date",
        "idx_transactions_account",
        "idx_transactions_tag",
        "idx_transactions_payee",
        "idx_transactions_kind_date",
        "idx_transactions_pair",
        "idx_transactions_refund",
        "idx_transactions_deleted",
    ],
    triggers: &[
        "trg_transactions_insert",
        "trg_transactions_update",
        "trg_transactions_delete",
    ],
    check_constraints: &[
        "kind IN ('expense', 'income', 'transfer', 'refund', 'adjustment')",
        "date BETWEEN '1970-01-01' AND '2100-12-31'",
        "amount > 0 AND amount <= 999999999999",
        "kind = 'transfer' AND transfer_account_id IS NOT NULL",
        "payee IS NULL OR length(payee) <= 128",
        "description IS NULL OR length(description) <= 1024",
    ],
};

const BUDGETS: TableManifest = TableManifest {
    name: "budgets",
    columns: &[
        text_pk!("id"),
        text_nn!("type_id"),
        text_nn!("month"),
        column!("allocated", INTEGER, true, None, false),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[ForeignKeyManifest {
        column: "type_id",
        references_table: "category_types",
        references_column: "id",
    }],
    indexes: &[],
    triggers: &[
        "trg_budgets_insert",
        "trg_budgets_update",
        "trg_budgets_delete",
    ],
    check_constraints: &[
        "month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'",
        "allocated >= 0",
    ],
};

const GOALS: TableManifest = TableManifest {
    name: "goals",
    columns: &[
        text_pk!("id"),
        text_nn!("name"),
        text_nn!("type"),
        column!("target_amount", INTEGER, true, None, false),
        text_nn!("target_date"),
        text_opt!("linked_account_id"),
        column!("starting_amount", INTEGER, true, None, false),
        int_default!("show_on_dashboard", "1"),
        column!("status", TEXT, true, Some("'active'"), false),
        text_opt!("closed_at"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[ForeignKeyManifest {
        column: "linked_account_id",
        references_table: "accounts",
        references_column: "id",
    }],
    indexes: &["idx_goals_status"],
    triggers: &["trg_goals_insert", "trg_goals_update", "trg_goals_delete"],
    check_constraints: &[
        "length(name) <= 64",
        "type IN ('savings', 'debt_payoff', 'net_worth')",
        "target_amount > 0",
        "status IN ('active', 'completed', 'abandoned', 'overdue')",
    ],
};

const RECONCILIATIONS: TableManifest = TableManifest {
    name: "reconciliations",
    columns: &[
        text_pk!("id"),
        text_nn!("account_id"),
        text_nn!("date"),
        column!("expected_balance", INTEGER, true, None, false),
        column!("actual_balance", INTEGER, true, None, false),
        text_opt!("adjustment_transaction_id"),
        text_opt!("notes"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[
        ForeignKeyManifest {
            column: "account_id",
            references_table: "accounts",
            references_column: "id",
        },
        ForeignKeyManifest {
            column: "adjustment_transaction_id",
            references_table: "transactions",
            references_column: "id",
        },
    ],
    indexes: &["idx_reconciliations_account"],
    triggers: &[
        "trg_reconciliations_insert",
        "trg_reconciliations_update",
        "trg_reconciliations_delete",
    ],
    check_constraints: &[],
};

const CHANGE_LOG: TableManifest = TableManifest {
    name: "change_log",
    columns: &[
        column!("id", INTEGER, false, None, true),
        text_nn!("table_name"),
        text_nn!("row_id"),
        text_nn!("operation"),
        text_nn!("timestamp"),
        text_nn!("device_id"),
        text_opt!("payload"),
    ],
    foreign_keys: &[],
    indexes: &["idx_change_log_timestamp"],
    triggers: &[],
    check_constraints: &["operation IN ('insert', 'update', 'delete')"],
};

const APP_META: TableManifest = TableManifest {
    name: "app_meta",
    columns: &[text_pk!("key"), text_nn!("value")],
    foreign_keys: &[],
    indexes: &[],
    triggers: &[],
    check_constraints: &[],
};

const CATEGORIZE_RULES: TableManifest = TableManifest {
    name: "categorize_rules",
    columns: &[
        text_pk!("id"),
        text_nn!("payee_term"),
        text_nn!("match_mode"),
        text_nn!("tag_id"),
        column!("source", TEXT, true, Some("'manual'"), false),
        int_default!("enabled", "1"),
        text_nn!("created_at"),
        text_nn!("updated_at"),
        text_opt!("deleted_at"),
    ],
    foreign_keys: &[ForeignKeyManifest {
        column: "tag_id",
        references_table: "category_tags",
        references_column: "id",
    }],
    indexes: &["idx_categorize_rules_enabled"],
    triggers: &[],
    check_constraints: &[
        "length(payee_term) BETWEEN 1 AND 128",
        "match_mode IN ('is', 'starts_with', 'contains')",
        "source IN ('manual', 'learned')",
    ],
};

const OPERATION_RECEIPTS: TableManifest = TableManifest {
    name: "operation_receipts",
    columns: &[
        text_pk!("operation_id"),
        text_nn!("command_kind"),
        text_nn!("request_hash"),
        text_nn!("result_json"),
        text_nn!("completed_at"),
    ],
    foreign_keys: &[],
    indexes: &[],
    triggers: &[],
    check_constraints: &[],
};

// ---------------------------------------------------------------------------
// Version manifests (table lists kept in alphabetical order to match the
// `ORDER BY name` read in `validate_manifest`)
// ---------------------------------------------------------------------------

const TABLES_V3: &[TableManifest] = &[
    ACCOUNTS,
    APP_META,
    BUDGETS,
    CATEGORY_TAGS,
    CATEGORY_TYPES_V3,
    CHANGE_LOG,
    GOALS,
    RECONCILIATIONS,
    TRANSACTIONS,
];

const TABLES_V4: &[TableManifest] = &[
    ACCOUNTS,
    APP_META,
    BUDGETS,
    CATEGORY_TAGS,
    CATEGORY_TYPES_V4,
    CHANGE_LOG,
    GOALS,
    RECONCILIATIONS,
    TRANSACTIONS,
];

const TABLES_V5: &[TableManifest] = &[
    ACCOUNTS,
    APP_META,
    BUDGETS,
    CATEGORIZE_RULES,
    CATEGORY_TAGS,
    CATEGORY_TYPES_V4,
    CHANGE_LOG,
    GOALS,
    RECONCILIATIONS,
    TRANSACTIONS,
];

const TABLES_V6: &[TableManifest] = &[
    ACCOUNTS,
    APP_META,
    BUDGETS,
    CATEGORIZE_RULES,
    CATEGORY_TAGS,
    CATEGORY_TYPES_V4,
    CHANGE_LOG,
    GOALS,
    OPERATION_RECEIPTS,
    RECONCILIATIONS,
    TRANSACTIONS,
];

/// The manifest for a released schema version, or `None` for unsupported ones.
pub fn manifest_for(version: i64) -> Option<&'static SchemaManifest> {
    match version {
        3 => Some(&SchemaManifest { version: 3, tables: TABLES_V3 }),
        4 => Some(&SchemaManifest { version: 4, tables: TABLES_V4 }),
        5 => Some(&SchemaManifest { version: 5, tables: TABLES_V5 }),
        6 => Some(&SchemaManifest { version: 6, tables: TABLES_V6 }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

/// Classify the database at `path` without ever opening it live.
///
/// A path that is absent is `Fresh`. Any existing file — even a zero-byte or
/// partially initialized one — is never fresh: it is inspected read-only and
/// classified as older/current/too-old/newer/invalid. Rejected states are
/// reported without any byte or sidecar mutation.
pub fn inspect_schema(path: &Path) -> SchemaInspection {
    if !path.exists() {
        return SchemaInspection::Fresh;
    }
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion },
    };
    // A zero-byte file is a valid empty SQLite database with no schema; the
    // design treats it as invalid, never fresh.
    if metadata.len() == 0 {
        return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion };
    }

    let connection = match open_read_only_at(path) {
        Ok(connection) => connection,
        Err(_) => return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion },
    };

    let tables: Vec<String> = match read_user_tables(&connection) {
        Ok(tables) => tables,
        Err(_) => return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion },
    };
    if tables.is_empty() {
        // Existing file with no tables is partially initialized.
        return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion };
    }
    if !tables.iter().any(|t| t == "app_meta") {
        return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion };
    }

    let version = match read_schema_version(&connection) {
        Some(version) => version,
        None => {
            return SchemaInspection::Invalid { reason: InvalidSchemaReason::MissingSchemaVersion };
        }
    };

    if version < 1 {
        return SchemaInspection::Invalid { reason: InvalidSchemaReason::InvalidSchemaVersion };
    }
    if version < MIN_SUPPORTED_SCHEMA_VERSION {
        return SchemaInspection::TooOld { version };
    }
    if version < LATEST_SCHEMA_VERSION {
        return SchemaInspection::Older { version };
    }
    if version == LATEST_SCHEMA_VERSION {
        return SchemaInspection::Current { version };
    }
    SchemaInspection::Newer { version }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Validate a live connection against the manifest for `version`.
///
/// Runs SQLite `integrity_check` and `foreign_key_check`, then compares the
/// actual tables, columns, defaults, primary/foreign keys, indexes, triggers,
/// and business-invariant CHECK constraints against the version manifest.
pub fn validate_manifest(connection: &rusqlite::Connection, version: i64) -> DbResult<()> {
    let manifest = manifest_for(version).ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;

    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(map_sqlite_error)?;
    if integrity != "ok" {
        return Err(DbError::new(ErrorCode::DatabaseCorrupt));
    }
    let foreign_key_violations: i64 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0))
        .map_err(map_sqlite_error)?;
    if foreign_key_violations != 0 {
        return Err(DbError::new(ErrorCode::DatabaseCorrupt));
    }

    let mut actual = read_user_tables(connection).map_err(map_sqlite_error)?;
    actual.sort();
    let mut expected: Vec<String> = manifest
        .tables
        .iter()
        .map(|table| table.name.to_string())
        .collect();
    expected.sort();
    if actual != expected {
        return Err(DbError::new(ErrorCode::DatabaseInvalid));
    }

    for table in manifest.tables {
        validate_table(connection, table)?;
    }
    Ok(())
}

/// Validate one table's columns, defaults, foreign keys, indexes, triggers,
/// and CHECK constraints against its manifest.
fn validate_table(connection: &rusqlite::Connection, table: &TableManifest) -> DbResult<()> {
    let sql = format!("PRAGMA table_info({})", table.name);
    let mut stmt = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TableInfoRow {
                name: row.get(1)?,
                r#type: row.get(2)?,
                not_null: row.get::<_, i64>(3)? != 0,
                default: row.get(4)?,
                primary_key: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(map_sqlite_error)?;
    let mut columns: Vec<TableInfoRow> = Vec::new();
    for row in rows {
        columns.push(row.map_err(map_sqlite_error)?);
    }
    drop(stmt);

    if columns.len() != table.columns.len() {
        return Err(DbError::new(ErrorCode::DatabaseInvalid));
    }
    for (index, expected) in table.columns.iter().enumerate() {
        let actual = &columns[index];
        if actual.name != expected.name
            || !actual.r#type.eq_ignore_ascii_case(expected.r#type)
            || actual.not_null != expected.not_null
            || actual.default.as_deref() != expected.default
            || actual.primary_key != expected.primary_key
        {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
    }

    for foreign_key in table.foreign_keys {
        if !foreign_key_declared(connection, table.name, foreign_key)? {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
    }
    for index in table.indexes {
        if !index_exists(connection, table.name, index)? {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
    }
    for trigger in table.triggers {
        if !trigger_exists(connection, trigger)? {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
    }

    if !table.check_constraints.is_empty() {
        // The stored CREATE TABLE SQL preserves the migration author's line
        // breaks, so compare whitespace-compacted text: the constraint is a
        // token-sequence check, not a formatting check.
        let table_sql = table_sql_text(connection, table.name)?;
        let table_sql_compact = compact_whitespace(&table_sql);
        for check in table.check_constraints {
            if !table_sql_compact.contains(&compact_whitespace(check)) {
                return Err(DbError::new(ErrorCode::DatabaseInvalid));
            }
        }
    }

    Ok(())
}

#[derive(Debug)]
struct TableInfoRow {
    name: String,
    r#type: String,
    not_null: bool,
    default: Option<String>,
    primary_key: bool,
}

fn read_user_tables(connection: &rusqlite::Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))?;
    names.collect()
}

fn read_schema_version(connection: &rusqlite::Connection) -> Option<i64> {
    let value: String = connection
        .query_row(
            "SELECT value FROM app_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .ok()?;
    value.parse::<i64>().ok()
}

fn foreign_key_declared(
    connection: &rusqlite::Connection,
    table: &str,
    expected: &ForeignKeyManifest,
) -> DbResult<bool> {
    let sql = format!("PRAGMA foreign_key_list({table})");
    let mut stmt = connection.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?))
        })
        .map_err(map_sqlite_error)?;
    for row in rows {
        let (references_table, from, references_column) = row.map_err(map_sqlite_error)?;
        if from == expected.column
            && references_table == expected.references_table
            && references_column == expected.references_column
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn index_exists(connection: &rusqlite::Connection, table: &str, index: &str) -> DbResult<bool> {
    let mut stmt = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1 AND tbl_name = ?2")
        .map_err(map_sqlite_error)?;
    Ok(stmt
        .query_row(rusqlite::params![index, table], |_| Ok(()))
        .is_ok())
}

fn trigger_exists(connection: &rusqlite::Connection, trigger: &str) -> DbResult<bool> {
    let mut stmt = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?1")
        .map_err(map_sqlite_error)?;
    Ok(stmt
        .query_row(rusqlite::params![trigger], |_| Ok(()))
        .is_ok())
}

fn table_sql_text(connection: &rusqlite::Connection, table: &str) -> DbResult<String> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            rusqlite::params![table],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)
}

/// Remove every whitespace character so CHECK expressions match regardless of
/// how the SQL text was line-wrapped.
fn compact_whitespace(input: &str) -> String {
    input.chars().filter(|c| !c.is_whitespace()).collect()
}
