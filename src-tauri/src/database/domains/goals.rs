//! Goal domain service — ported from `src/lib/db/repos/goals.ts`.
//!
//! Goal CRUD with progress and velocity calculation.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::domains::accounts::today_iso;
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{GoalStatus, GoalType, GoalWithProgress, OperationId, VelocityStatus};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute balance for a single account as of today.
fn get_balance(conn: &Connection, account_id: &str) -> DbResult<i64> {
    let today = today_iso();
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE
                WHEN kind = 'income' THEN amount
                WHEN kind = 'adjustment' THEN amount
                WHEN kind = 'refund' THEN amount
                WHEN kind = 'expense' THEN -amount
                WHEN kind = 'transfer' AND account_id = ?1 THEN -amount
                WHEN kind = 'transfer' AND transfer_account_id = ?1 THEN amount
                ELSE 0
            END), 0)
            FROM transactions
            WHERE (account_id = ?1 OR (kind = 'transfer' AND transfer_account_id = ?1))
              AND deleted_at IS NULL
              AND date <= ?2",
            params![account_id, today],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    Ok(total)
}

/// Parse a goal type string into the enum.
fn parse_goal_type(s: &str) -> DbResult<GoalType> {
    match s {
        "savings" => Ok(GoalType::Savings),
        "debt_payoff" => Ok(GoalType::DebtPayoff),
        "net_worth" => Ok(GoalType::NetWorth),
        _ => Err(DbError::new(ErrorCode::InvalidInput)),
    }
}

/// Parse a goal status string into the enum.
fn parse_goal_status(s: &str) -> DbResult<GoalStatus> {
    match s {
        "active" => Ok(GoalStatus::Active),
        "completed" => Ok(GoalStatus::Completed),
        "abandoned" => Ok(GoalStatus::Abandoned),
        "overdue" => Ok(GoalStatus::Overdue),
        _ => Err(DbError::new(ErrorCode::InvalidInput)),
    }
}

/// Enrich a goal with progress and velocity status.
fn enrich_goal(conn: &Connection, goal: &GoalWithProgress) -> DbResult<GoalWithProgress> {
    let current_amount = if goal.goal_type == GoalType::NetWorth {
        // Sum all account balances.
        let mut stmt = conn
            .prepare("SELECT id FROM accounts WHERE deleted_at IS NULL")
            .map_err(map_sqlite_error)?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;
        let mut total = 0i64;
        for id in ids {
            total += get_balance(conn, &id)?;
        }
        total
    } else {
        match &goal.linked_account_id {
            Some(account_id) => get_balance(conn, account_id)?,
            None => 0,
        }
    };

    let progress_pct = if goal.target_amount > 0 {
        let raw = (current_amount as f64 / goal.target_amount as f64 * 100.0).round() as i64;
        raw.min(100)
    } else {
        0
    };

    let velocity_status = compute_velocity_status(goal, current_amount);

    Ok(GoalWithProgress {
        id: goal.id.clone(),
        name: goal.name.clone(),
        goal_type: goal.goal_type,
        target_amount: goal.target_amount,
        target_date: goal.target_date.clone(),
        linked_account_id: goal.linked_account_id.clone(),
        starting_amount: goal.starting_amount,
        show_on_dashboard: goal.show_on_dashboard,
        status: goal.status,
        closed_at: goal.closed_at.clone(),
        created_at: goal.created_at.clone(),
        updated_at: goal.updated_at.clone(),
        current_amount,
        progress_pct,
        velocity_status,
    })
}

/// Compute velocity status for a goal.
fn compute_velocity_status(goal: &GoalWithProgress, current: i64) -> VelocityStatus {
    let today = today_iso();
    let target_date = &goal.target_date;

    // If target date passed and goal not reached → overdue.
    if target_date < &today && current < goal.target_amount {
        return VelocityStatus::Overdue;
    }

    // Parse dates for velocity calculation.
    let today_parts: Vec<i64> = today.split('-').filter_map(|p| p.parse().ok()).collect();
    let created_parts: Vec<i64> = goal.created_at.split('-').filter_map(|p| p.parse().ok()).collect();
    let target_parts: Vec<i64> = target_date.split('-').filter_map(|p| p.parse().ok()).collect();

    if today_parts.len() < 3 || created_parts.len() < 3 || target_parts.len() < 3 {
        return VelocityStatus::InsufficientData;
    }

    let months_elapsed = (today_parts[0] - created_parts[0]) * 12
        + (today_parts[1] - created_parts[1]);

    if months_elapsed < 3 {
        return VelocityStatus::InsufficientData;
    }

    let progress_made = current - goal.starting_amount;
    let velocity = progress_made as f64 / months_elapsed as f64;

    let months_remaining = (target_parts[0] - today_parts[0]) * 12
        + (target_parts[1] - today_parts[1]);

    if months_remaining <= 0 {
        return if current >= goal.target_amount {
            VelocityStatus::OnTrack
        } else {
            VelocityStatus::Overdue
        };
    }

    let remaining = goal.target_amount - current;
    let required_velocity = remaining as f64 / months_remaining as f64;

    if velocity >= required_velocity * 1.2 {
        VelocityStatus::Ahead
    } else if velocity >= required_velocity {
        VelocityStatus::OnTrack
    } else {
        VelocityStatus::Behind
    }
}

/// Parse a goal row from SQL into GoalWithProgress (without progress fields).
fn parse_goal_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<GoalWithProgress> {
    let type_str: String = row.get(2)?;
    let status_str: String = row.get(8)?;
    Ok(GoalWithProgress {
        id: row.get(0)?,
        name: row.get(1)?,
        goal_type: parse_goal_type(&type_str).unwrap_or(GoalType::Savings),
        target_amount: row.get(3)?,
        target_date: row.get(4)?,
        linked_account_id: row.get(5)?,
        starting_amount: row.get(6)?,
        show_on_dashboard: row.get(7)?,
        status: parse_goal_status(&status_str).unwrap_or(GoalStatus::Active),
        closed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        current_amount: 0,
        progress_pct: 0,
        velocity_status: VelocityStatus::InsufficientData,
    })
}

const GOAL_COLUMNS: &str = "id, name, type, target_amount, target_date, linked_account_id, starting_amount, show_on_dashboard, status, closed_at, created_at, updated_at";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// List all active goals with progress.
pub fn list_goals(conn: &Connection) -> DbResult<Vec<GoalWithProgress>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM goals WHERE deleted_at IS NULL ORDER BY target_date",
            GOAL_COLUMNS
        ))
        .map_err(map_sqlite_error)?;
    let rows = stmt.query_map([], parse_goal_row).map_err(map_sqlite_error)?;
    let mut goals = Vec::new();
    for row in rows {
        let goal = row.map_err(map_sqlite_error)?;
        goals.push(enrich_goal(conn, &goal)?);
    }
    Ok(goals)
}

/// Get a single goal by ID.
pub fn get_goal(conn: &Connection, id: &str) -> DbResult<Option<GoalWithProgress>> {
    let goal: Option<GoalWithProgress> = conn
        .query_row(
            &format!(
                "SELECT {} FROM goals WHERE id = ?1 AND deleted_at IS NULL",
                GOAL_COLUMNS
            ),
            [id],
            parse_goal_row,
        )
        .optional()
        .map_err(map_sqlite_error)?;
    match goal {
        Some(g) => Ok(Some(enrich_goal(conn, &g)?)),
        None => Ok(None),
    }
}

/// Create a new goal. Returns the new ID.
pub fn create_goal(
    conn: &mut Connection,
    op_id: OperationId,
    name: String,
    goal_type: GoalType,
    target_amount: i64,
    target_date: String,
    linked_account_id: Option<String>,
    starting_amount: i64,
    show_on_dashboard: i64,
) -> DbResult<String> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Created { id: String }

    #[derive(serde::Serialize)]
    struct CreateRequest {
        name: String,
        goal_type: &'static str,
        target_amount: i64,
        target_date: String,
        linked_account_id: Option<String>,
        starting_amount: i64,
        show_on_dashboard: i64,
    }

    let req = CreateRequest {
        name: name.clone(),
        goal_type: goal_type.as_str(),
        target_amount,
        target_date: target_date.clone(),
        linked_account_id: linked_account_id.clone(),
        starting_amount,
        show_on_dashboard,
    };

    run_idempotent(conn, op_id, "create_goal", &req, |tx| {
        let now = now_iso_utc();
        let id = OperationId::generate().as_str().to_string();
        tx.execute(
            "INSERT INTO goals (id, name, type, target_amount, target_date, linked_account_id, starting_amount, show_on_dashboard, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                name,
                goal_type.as_str(),
                target_amount,
                target_date,
                linked_account_id,
                starting_amount,
                show_on_dashboard,
                now,
                now
            ],
        )
        .map_err(map_sqlite_error)?;
        Ok(Created { id })
    })
    .map(|r| r.id)
}

/// Update a goal. Status changes to 'completed' or 'abandoned' set closed_at.
pub fn update_goal(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    name: Option<String>,
    target_amount: Option<i64>,
    target_date: Option<String>,
    show_on_dashboard: Option<i64>,
    status: Option<GoalStatus>,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    #[derive(serde::Serialize)]
    struct UpdateRequest {
        id: String,
        name: Option<String>,
        target_amount: Option<i64>,
        target_date: Option<String>,
        show_on_dashboard: Option<i64>,
        status: Option<String>,
    }

    let req = UpdateRequest {
        id: id.to_string(),
        name: name.clone(),
        target_amount,
        target_date: target_date.clone(),
        show_on_dashboard,
        status: status.map(|s| s.as_str().to_string()),
    };

    run_idempotent(conn, op_id, "update_goal", &req, |tx| {
        let now = now_iso_utc();
        let closed_at = status
            .filter(|s| matches!(s, GoalStatus::Completed | GoalStatus::Abandoned))
            .map(|_| now.clone());

        // Build dynamic SQL and params.
        let mut sql_parts = vec!["updated_at = ?1".to_string()];
        let mut param_idx = 2u32;

        if name.is_some() {
            sql_parts.push(format!("name = ?{}", param_idx));
            param_idx += 1;
        }
        if target_amount.is_some() {
            sql_parts.push(format!("target_amount = ?{}", param_idx));
            param_idx += 1;
        }
        if target_date.is_some() {
            sql_parts.push(format!("target_date = ?{}", param_idx));
            param_idx += 1;
        }
        if show_on_dashboard.is_some() {
            sql_parts.push(format!("show_on_dashboard = ?{}", param_idx));
            param_idx += 1;
        }
        if status.is_some() {
            sql_parts.push(format!("status = ?{}", param_idx));
            param_idx += 1;
        }
        if closed_at.is_some() {
            sql_parts.push(format!("closed_at = ?{}", param_idx));
            param_idx += 1;
        }

        // Always append id as last param.
        let sql = format!(
            "UPDATE goals SET {} WHERE id = ?{} AND deleted_at IS NULL",
            sql_parts.join(", "),
            param_idx
        );

        // Build params in the same order as the SQL placeholders.
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        if let Some(ref n) = name {
            param_values.push(Box::new(n.clone()));
        }
        if let Some(ta) = target_amount {
            param_values.push(Box::new(ta));
        }
        if let Some(ref td) = target_date {
            param_values.push(Box::new(td.clone()));
        }
        if let Some(sd) = show_on_dashboard {
            param_values.push(Box::new(sd));
        }
        if let Some(ref s) = status {
            param_values.push(Box::new(s.as_str().to_string()));
        }
        if let Some(ref ca) = closed_at {
            param_values.push(Box::new(ca.clone()));
        }
        param_values.push(Box::new(id.to_string()));

        let affected = tx
            .execute(&sql, rusqlite::params_from_iter(param_values.as_slice()))
            .map_err(map_sqlite_error)?;

        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        Ok(Void {})
    })
    .map(|_| ())
}

/// Soft-delete a goal.
pub fn delete_goal(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "delete_goal", &id.to_string(), |tx| {
        let now = now_iso_utc();
        let affected = tx
            .execute(
                "UPDATE goals SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
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
