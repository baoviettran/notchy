//! Meaningful committed profile revisions and durable automatic-backup metadata.
//! Revision changes share the financial transaction, so rollback restores both.

use rusqlite::{Connection, Transaction};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};

// Versioned membership preserves old manifests when later migrations add tables.
pub const CONTENT_TABLES_V8: &[&str] = &[
    "accounts", "transactions", "category_types", "category_tags", "budgets",
    "goals", "reconciliations", "categorize_rules", "schedules",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticBackupStatus {
    pub enabled: bool,
    #[ts(type = "number")]
    pub content_revision: i64,
    #[ts(type = "number")]
    pub backed_up_revision: i64,
    pub last_success_at: Option<String>,
    pub last_success_date: Option<String>,
    pub next_eligible_date: Option<String>,
    pub warning: Option<String>,
    pub prune_warning: Option<String>,
}

/// Read persisted success state; the clock/policy layer fills next eligibility.
pub fn read_automatic_status(conn: &Connection) -> DbResult<AutomaticBackupStatus> {
    let status = conn.query_row(
        "SELECT enabled, content_revision, backed_up_revision, last_success_at, last_success_date,
                warning, prune_warning FROM automatic_backup_state WHERE id = 1",
        [],
        |row| Ok(AutomaticBackupStatus {
            enabled: row.get::<_, i64>(0)? != 0,
            content_revision: row.get(1)?,
            backed_up_revision: row.get(2)?,
            last_success_at: row.get(3)?,
            last_success_date: row.get(4)?,
            next_eligible_date: None,
            warning: row.get(5)?,
            prune_warning: row.get(6)?,
        }),
    ).map_err(map_sqlite_error)?;
    if !(0..=9_007_199_254_740_991).contains(&status.content_revision)
        || !(0..=status.content_revision).contains(&status.backed_up_revision)
    {
        return Err(DbError::new(ErrorCode::DatabaseInvalid));
    }
    Ok(status)
}

/// Later content migrations call this after creating their own tables.
/// Timestamp-only updates are excluded; durable scheduler progress is content.
pub fn install_content_revision_triggers(tx: &Transaction<'_>, tables: &[&str]) -> DbResult<()> {
    for statement in content_revision_statements(tx, tables)? {
        tx.execute_batch(&statement).map_err(map_sqlite_error)?;
    }
    Ok(())
}

fn identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(crate) fn content_revision_statements(conn: &Connection, tables: &[&str]) -> DbResult<Vec<String>> {
    let mut statements = Vec::new();
    for table in tables {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", identifier(table)))
            .map_err(map_sqlite_error)?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(map_sqlite_error)?
            .collect::<rusqlite::Result<_>>()
            .map_err(map_sqlite_error)?;
        if columns.is_empty() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        let changes = columns.iter()
            .filter(|column| !matches!(column.as_str(), "created_at" | "updated_at"))
            .map(|column| format!("OLD.{0} IS NOT NEW.{0}", identifier(column)))
            .collect::<Vec<_>>()
            .join(" OR ");
        for operation in ["insert", "update", "delete"] {
            let condition = if operation == "update" {
                format!("WHEN {}", if changes.is_empty() { "0" } else { &changes })
            } else {
                String::new()
            };
            statements.push(format!(
                "CREATE TRIGGER IF NOT EXISTS {trigger} AFTER {operation} ON {table} {condition}
                 BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END",
                trigger = identifier(&format!("trg_content_{table}_{operation}")),
                table = identifier(table),
            ));
        }
    }
    Ok(statements)
}

// Seed-only scratch profiles stay clean. Any user content, changed/deleted seed,
// or first-use financial setting makes an upgraded profile initially eligible.
pub(crate) const AUTOMATIC_BACKUP_SCHEMA: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS automatic_backup_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    content_revision INTEGER NOT NULL DEFAULT 0 CHECK (content_revision BETWEEN 0 AND 9007199254740991),
    backed_up_revision INTEGER NOT NULL DEFAULT 0 CHECK (backed_up_revision BETWEEN 0 AND content_revision),
    last_success_at TEXT,
    last_success_date TEXT,
    last_success_offset_minutes INTEGER,
    warning TEXT,
    prune_warning TEXT,
    pending_job_id TEXT,
    pending_relative_filename TEXT,
    pending_revision INTEGER CHECK (pending_revision BETWEEN 0 AND 9007199254740991),
    pending_local_date TEXT,
    pending_local_week TEXT,
    pending_offset_minutes INTEGER,
    pending_started_at TEXT
)"#,
    r#"CREATE TABLE IF NOT EXISTS automatic_backup_copies (
    id TEXT PRIMARY KEY,
    relative_filename TEXT NOT NULL UNIQUE CHECK (length(relative_filename) > 0 AND instr(relative_filename, '/') = 0 AND instr(relative_filename, char(92)) = 0 AND relative_filename NOT IN ('.', '..')),
    schema_version INTEGER NOT NULL CHECK (schema_version >= 3),
    captured_revision INTEGER NOT NULL CHECK (captured_revision BETWEEN 0 AND 9007199254740991),
    local_date TEXT NOT NULL,
    local_week TEXT NOT NULL,
    created_at TEXT NOT NULL,
    publication_job_id TEXT NOT NULL UNIQUE,
    offset_minutes INTEGER NOT NULL
)"#,
    r#"INSERT OR IGNORE INTO automatic_backup_state (id, content_revision)
SELECT 1, CASE WHEN
    EXISTS (SELECT 1 FROM accounts)
    OR EXISTS (SELECT 1 FROM transactions)
    OR EXISTS (SELECT 1 FROM budgets)
    OR EXISTS (SELECT 1 FROM goals)
    OR EXISTS (SELECT 1 FROM reconciliations)
    OR EXISTS (SELECT 1 FROM categorize_rules)
    OR EXISTS (SELECT 1 FROM schedules)
    OR EXISTS (SELECT 1 FROM app_meta WHERE key IN ('currency', 'first_run_complete', 'onboarding_step'))
    OR (SELECT COUNT(*) FROM category_types) <> 4
    OR EXISTS (
        SELECT id, name, is_system, budgetable, sort_order, deleted_at, rollover_enabled FROM category_types
        EXCEPT VALUES
            ('bucket_essentials', 'Essentials', 0, 1, 0, NULL, 1),
            ('bucket_learning', 'Learning & Entertainment', 0, 1, 1, NULL, 1),
            ('bucket_saving', 'Saving & Investment', 0, 1, 2, NULL, 1),
            ('bucket_adjustments', 'Adjustments', 1, 0, 3, NULL, 1)
    )
    OR (SELECT COUNT(*) FROM category_tags) <> 4
    OR EXISTS (
        SELECT id, type_id, name, is_system, sort_order, deleted_at FROM category_tags
        EXCEPT VALUES
            ('tag_initial_balance', 'bucket_adjustments', 'Initial Balance', 1, 0, NULL),
            ('tag_loss', 'bucket_adjustments', 'Loss', 1, 0, NULL),
            ('tag_gift', 'bucket_adjustments', 'Gift', 1, 0, NULL),
            ('tag_reconciliation', 'bucket_adjustments', 'Reconciliation', 1, 0, NULL)
    )
THEN 1 ELSE 0 END"#,
    r#"CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_insert AFTER INSERT ON app_meta
WHEN NEW.key IN ('currency', 'first_run_complete', 'onboarding_step')
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END"#,
    r#"CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_delete AFTER DELETE ON app_meta
WHEN OLD.key IN ('currency', 'first_run_complete', 'onboarding_step')
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END"#,
    r#"CREATE TRIGGER IF NOT EXISTS trg_content_app_meta_update AFTER UPDATE ON app_meta
WHEN (OLD.key IN ('currency', 'first_run_complete', 'onboarding_step') OR NEW.key IN ('currency', 'first_run_complete', 'onboarding_step')) AND (OLD.key IS NOT NEW.key OR OLD.value IS NOT NEW.value)
BEGIN UPDATE automatic_backup_state SET content_revision = content_revision + 1 WHERE id = 1; END"#,
];

use crate::database::clock::{validated_clock, BackupClock};
use chrono::{DateTime, NaiveDate};
use std::collections::HashSet;

/// Registry metadata plus independently established verification and ownership.
/// Restored/unbound registries must be passed with owned=false.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticCopy {
    pub id: String,
    pub relative_filename: String,
    pub schema_version: i64,
    pub captured_revision: i64,
    pub local_date: String,
    pub local_week: String,
    pub created_at: String,
    pub publication_job_id: String,
    pub offset_minutes: i32,
    pub kind: String,
    pub verified: bool,
    pub owned: bool,
}

pub fn automatic_backup_due(status: &AutomaticBackupStatus, clock: &BackupClock) -> bool {
    let Some(now) = validated_clock(clock) else { return false; };
    if !status.enabled || status.content_revision <= status.backed_up_revision { return false; }
    if let Some(date) = &status.last_success_date {
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() || clock.local_date <= *date { return false; }
    }
    match &status.last_success_at {
        None => true,
        Some(at) => DateTime::parse_from_rfc3339(at).is_ok_and(|last| now > last),
    }
}

/// Gate destructive pruning using the last successful observation. Offset or
/// backward clock changes defer pruning; a subsequent stable success reanchors it.
pub fn automatic_prune_clock_trusted(previous: &BackupClock, current: &BackupClock) -> bool {
    match (validated_clock(previous), validated_clock(current)) {
        (Some(before), Some(now)) => current.offset_minutes == previous.offset_minutes
            && now >= before && current.local_date >= previous.local_date,
        _ => false,
    }
}

/// Pure deletion candidates only. The coordinator must first establish a trusted
/// clock and pass verified, session-owned registry entries; never infer ownership
/// from filenames. Creation instants, not labels or input ordering, rank copies.
pub fn automatic_retention_ids(copies: &[AutomaticCopy], protected_id: &str) -> Vec<String> {
    let mut eligible: Vec<_> = copies.iter().filter_map(|copy| {
        if copy.kind != "automatic" || !copy.verified || !copy.owned { return None; }
        let clock = BackupClock { now_iso: copy.created_at.clone(), local_date: copy.local_date.clone(), iso_week: copy.local_week.clone(), offset_minutes: copy.offset_minutes };
        Some((copy, validated_clock(&clock)?))
    }).collect();
    eligible.sort_by(|(a, at), (b, bt)| bt.cmp(at).then_with(|| b.id.cmp(&a.id)));
    let mut keep = HashSet::from([protected_id.to_string()]);
    let mut dates = HashSet::new();
    let mut weeks = HashSet::new();
    let mut schemas = HashSet::new();
    for (copy, _) in &eligible {
        let daily = dates.len() < 7 && dates.insert(copy.local_date.clone());
        let weekly = weeks.len() < 4 && weeks.insert(copy.local_week.clone());
        let schema = schemas.insert(copy.schema_version);
        if daily || weekly || schema { keep.insert(copy.id.clone()); }
    }
    eligible.into_iter().filter(|(copy, _)| !keep.contains(&copy.id)).map(|(copy, _)| copy.id.clone()).collect()
}
