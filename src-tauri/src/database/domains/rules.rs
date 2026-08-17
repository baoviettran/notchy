//! Categorize rule domain service — ported from `src/lib/db/repos/rules.ts`.
//!
//! Rule CRUD and learned rule upsert.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{CategorizeRule, MatchMode, OperationId, RuleSource};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a match mode string into the enum.
fn parse_match_mode(s: &str) -> DbResult<MatchMode> {
    match s {
        "is" => Ok(MatchMode::Is),
        "starts_with" => Ok(MatchMode::StartsWith),
        "contains" => Ok(MatchMode::Contains),
        _ => Err(DbError::new(ErrorCode::InvalidInput)),
    }
}

/// Parse a rule source string into the enum.
fn parse_rule_source(s: &str) -> DbResult<RuleSource> {
    match s {
        "manual" => Ok(RuleSource::Manual),
        "learned" => Ok(RuleSource::Learned),
        _ => Err(DbError::new(ErrorCode::InvalidInput)),
    }
}

/// Parse a rule row from SQL.
fn parse_rule_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CategorizeRule> {
    let mode_str: String = row.get(2)?;
    let source_str: String = row.get(4)?;
    Ok(CategorizeRule {
        id: row.get(0)?,
        payee_term: row.get(1)?,
        match_mode: parse_match_mode(&mode_str).unwrap_or(MatchMode::Is),
        tag_id: row.get(3)?,
        source: parse_rule_source(&source_str).unwrap_or(RuleSource::Manual),
        enabled: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// List enabled, non-deleted rules.
pub fn list_rules(conn: &Connection) -> DbResult<Vec<CategorizeRule>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at
             FROM categorize_rules
             WHERE enabled = 1 AND deleted_at IS NULL
             ORDER BY created_at DESC",
        )
        .map_err(map_sqlite_error)?;
    let rows = stmt.query_map([], parse_rule_row).map_err(map_sqlite_error)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite_error)?);
    }
    Ok(out)
}

/// List all rules (including disabled and deleted).
pub fn list_all_rules(conn: &Connection) -> DbResult<Vec<CategorizeRule>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at
             FROM categorize_rules
             ORDER BY created_at DESC",
        )
        .map_err(map_sqlite_error)?;
    let rows = stmt.query_map([], parse_rule_row).map_err(map_sqlite_error)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite_error)?);
    }
    Ok(out)
}

/// Create a new categorize rule. Returns the created rule.
pub fn create_rule(
    conn: &mut Connection,
    op_id: OperationId,
    payee_term: String,
    match_mode: MatchMode,
    tag_id: String,
    source: RuleSource,
) -> DbResult<CategorizeRule> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Created { id: String }

    #[derive(serde::Serialize)]
    struct CreateRequest {
        payee_term: String,
        match_mode: &'static str,
        tag_id: String,
        source: &'static str,
    }

    let req = CreateRequest {
        payee_term: payee_term.clone(),
        match_mode: match_mode.as_str(),
        tag_id: tag_id.clone(),
        source: source.as_str(),
    };

    let id = run_idempotent(conn, op_id, "create_rule", &req, |tx| {
        let now = now_iso_utc();
        let id = OperationId::generate().as_str().to_string();
        tx.execute(
            "INSERT INTO categorize_rules (id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
            params![
                id,
                payee_term,
                match_mode.as_str(),
                tag_id,
                source.as_str(),
                now,
                now
            ],
        )
        .map_err(map_sqlite_error)?;
        Ok(Created { id })
    })?
    .id;

    get_rule(conn, &id)?
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseCorrupt))
}

/// Update a rule. Returns the updated rule.
pub fn update_rule(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    payee_term: Option<String>,
    match_mode: Option<MatchMode>,
    tag_id: Option<String>,
    source: Option<RuleSource>,
    enabled: Option<i64>,
) -> DbResult<CategorizeRule> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    #[derive(serde::Serialize)]
    struct UpdateRequest {
        id: String,
        payee_term: Option<String>,
        match_mode: Option<String>,
        tag_id: Option<String>,
        source: Option<String>,
        enabled: Option<i64>,
    }

    let req = UpdateRequest {
        id: id.to_string(),
        payee_term: payee_term.clone(),
        match_mode: match_mode.map(|m| m.as_str().to_string()),
        tag_id: tag_id.clone(),
        source: source.map(|s| s.as_str().to_string()),
        enabled,
    };

    run_idempotent(conn, op_id, "update_rule", &req, |tx| {
        let now = now_iso_utc();

        // Build dynamic SQL and params.
        let mut sql_parts = Vec::new();
        let mut param_idx = 1u32;

        if payee_term.is_some() {
            sql_parts.push(format!("payee_term = ?{}", param_idx));
            param_idx += 1;
        }
        if match_mode.is_some() {
            sql_parts.push(format!("match_mode = ?{}", param_idx));
            param_idx += 1;
        }
        if tag_id.is_some() {
            sql_parts.push(format!("tag_id = ?{}", param_idx));
            param_idx += 1;
        }
        if source.is_some() {
            sql_parts.push(format!("source = ?{}", param_idx));
            param_idx += 1;
        }
        if enabled.is_some() {
            sql_parts.push(format!("enabled = ?{}", param_idx));
            param_idx += 1;
        }
        sql_parts.push(format!("updated_at = ?{}", param_idx));
        param_idx += 1;

        // Always append id as last param.
        let sql = format!(
            "UPDATE categorize_rules SET {} WHERE id = ?{}",
            sql_parts.join(", "),
            param_idx
        );

        // Build params in the same order as the SQL placeholders.
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(ref pt) = payee_term {
            param_values.push(Box::new(pt.clone()));
        }
        if let Some(mm) = match_mode {
            param_values.push(Box::new(mm.as_str().to_string()));
        }
        if let Some(ref tid) = tag_id {
            param_values.push(Box::new(tid.clone()));
        }
        if let Some(s) = source {
            param_values.push(Box::new(s.as_str().to_string()));
        }
        if let Some(e) = enabled {
            param_values.push(Box::new(e));
        }
        param_values.push(Box::new(now));
        param_values.push(Box::new(id.to_string()));

        let affected = tx
            .execute(&sql, rusqlite::params_from_iter(param_values.as_slice()))
            .map_err(map_sqlite_error)?;

        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        Ok(Void {})
    })?;

    get_rule(conn, id)?
        .ok_or_else(|| DbError::new(ErrorCode::DatabaseCorrupt))
}

/// Get a single rule by ID (excluding soft-deleted).
pub fn get_rule(conn: &Connection, id: &str) -> DbResult<Option<CategorizeRule>> {
    let rule = conn
        .query_row(
            "SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at
             FROM categorize_rules WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            parse_rule_row,
        )
        .optional()
        .map_err(map_sqlite_error)?;
    Ok(rule)
}

/// Soft-delete a rule.
pub fn delete_rule(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "delete_rule", &id.to_string(), |tx| {
        let now = now_iso_utc();
        let affected = tx
            .execute(
                "UPDATE categorize_rules SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![now, now, id],
            )
            .map_err(map_sqlite_error)?;
        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Normalize a payee string for matching (lowercase, trim, collapse whitespace).
fn normalize_payee(s: &str) -> String {
    s.to_lowercase()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Upsert a learned rule. Finds existing learned rule with same normalized
/// payee_term and 'is' match_mode, updates tag_id. Otherwise creates new.
pub fn upsert_learned(
    conn: &mut Connection,
    op_id: OperationId,
    payee_term: String,
    tag_id: String,
) -> DbResult<CategorizeRule> {
    let normalized = normalize_payee(&payee_term);

    // Find existing learned rule with same normalized payee and 'is' mode.
    let existing: Option<CategorizeRule> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at
                 FROM categorize_rules WHERE source = 'learned' AND deleted_at IS NULL",
            )
            .map_err(map_sqlite_error)?;
        let rows = stmt.query_map([], parse_rule_row).map_err(map_sqlite_error)?;
        let mut found = None;
        for row in rows {
            let rule = row.map_err(map_sqlite_error)?;
            if normalize_payee(&rule.payee_term) == normalized && rule.match_mode == MatchMode::Is {
                found = Some(rule);
                break;
            }
        }
        found
    };

    if let Some(rule) = existing {
        update_rule(conn, op_id, &rule.id, None, None, Some(tag_id), None, None)
    } else {
        create_rule(conn, op_id, payee_term, MatchMode::Is, tag_id, RuleSource::Learned)
    }
}
