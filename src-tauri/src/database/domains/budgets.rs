//! Budget domain service — ported from `src/lib/db/repos/budgets.ts`.
//!
//! Budget allocation, rollover, copy-previous, and summary queries.

use rusqlite::{Connection, params, OptionalExtension};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{Budget, BudgetSummary, OperationId};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Split a `YYYY-MM` month string, rejecting anything the schema would not
/// accept. `next_month` and `previous_month` used to `unwrap_or(1)` every
/// segment and index the result, so a month with no `-` panicked and a
/// non-numeric one silently became January.
fn parse_month(month: &str) -> DbResult<(i32, i32)> {
    let invalid = || DbError::new(ErrorCode::InvalidInput);

    let parts: Vec<&str> = month.split('-').collect();
    if parts.len() != 2 || parts[0].len() != 4 || parts[1].len() != 2 {
        return Err(invalid());
    }
    let year: i32 = parts[0].parse().map_err(|_| invalid())?;
    let month_number: i32 = parts[1].parse().map_err(|_| invalid())?;
    if !(1..=12).contains(&month_number) {
        return Err(invalid());
    }
    Ok((year, month_number))
}

/// Increment a `YYYY-MM` month string by one.
fn next_month(month: &str) -> DbResult<String> {
    let (year, month_number) = parse_month(month)?;
    Ok(if month_number == 12 {
        format!("{:04}-01", year + 1)
    } else {
        format!("{:04}-{:02}", year, month_number + 1)
    })
}

/// Decrement a `YYYY-MM` month string by one.
fn previous_month(month: &str) -> DbResult<String> {
    let (year, month_number) = parse_month(month)?;
    Ok(if month_number == 1 {
        format!("{:04}-12", year - 1)
    } else {
        format!("{:04}-{:02}", year, month_number - 1)
    })
}

/// Compute the total spent for a bucket in a given month.
/// Expenses add, refunds subtract.
pub fn get_spent_for_bucket(conn: &Connection, type_id: &str, month: &str) -> DbResult<i64> {
    let next = next_month(month)?;
    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(
                CASE WHEN t.kind = 'expense' THEN t.amount
                     WHEN t.kind = 'refund' THEN -t.amount
                     ELSE 0 END
            ), 0)
            FROM transactions t
            JOIN category_tags ct ON t.tag_id = ct.id
            WHERE ct.type_id = ?1
              AND t.date >= ?2 || '-01'
              AND t.date < ?3 || '-01'
              AND t.kind IN ('expense', 'refund')
              AND t.deleted_at IS NULL",
            params![type_id, month, next],
            |r| r.get(0),
        )
        .map_err(map_sqlite_error)?;
    Ok(total)
}

/// Cumulative rollover for a bucket before `month`.
///
/// Rollover ON: sum of `allocated - spent` over every prior budgeted month,
/// negatives included. Rollover OFF: a running floor in chronological order,
/// `C_m = max(0, C_{m-1} + L_{m-1})`, so the carry never goes negative. Only
/// prior months with a budget row contribute (budget-row gating).
pub fn get_rolled_over(conn: &Connection, type_id: &str, month: &str) -> DbResult<i64> {
    let enabled: i32 = conn
        .query_row(
            "SELECT rollover_enabled FROM category_types WHERE id = ?1",
            params![type_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .unwrap_or(1);

    let mut stmt = conn
        .prepare(
            "SELECT month, allocated FROM budgets
             WHERE type_id = ?1 AND month < ?2 AND deleted_at IS NULL
             ORDER BY month",
        )
        .map_err(map_sqlite_error)?;
    let months: Vec<(String, i64)> = stmt
        .query_map(params![type_id, month], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let mut rolled = 0i64;
    for (m, allocated) in months {
        let spent = get_spent_for_bucket(conn, type_id, &m)?;
        rolled += allocated - spent;
        if enabled == 0 {
            rolled = rolled.max(0);
        }
    }
    Ok(rolled)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Get budget summaries for a month, with spending and rollover.
pub fn get_budgets_for_month(conn: &Connection, month: &str) -> DbResult<Vec<BudgetSummary>> {
    // Validate the month before the SELECT: a malformed month matches no row,
    // and without this the `is_empty()` early return below would report an
    // empty month rather than rejecting bad input.
    parse_month(month)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, type_id, month, allocated, created_at, updated_at
             FROM budgets WHERE month = ?1 AND deleted_at IS NULL",
        )
        .map_err(map_sqlite_error)?;
    let budgets: Vec<Budget> = stmt
        .query_map(params![month], |row| Ok(Budget {
            id: row.get(0)?,
            type_id: row.get(1)?,
            month: row.get(2)?,
            allocated: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        }))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    if budgets.is_empty() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for b in &budgets {
        let spent = get_spent_for_bucket(conn, &b.type_id, month)?;
        let rolled_over = get_rolled_over(conn, &b.type_id, month)?;
        let available = b.allocated + rolled_over - spent;
        result.push(BudgetSummary {
            type_id: b.type_id.clone(),
            month: b.month.clone(),
            allocated: b.allocated,
            spent,
            remaining: b.allocated - spent,
            rolled_over,
            available,
        });
    }
    Ok(result)
}

/// Upsert a budget allocation for a (type_id, month) pair.
pub fn set_allocation(
    conn: &mut Connection,
    op_id: OperationId,
    type_id: &str,
    month: &str,
    allocated: i64,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "set_allocation", &(&type_id, &month, &allocated), |tx| {
        let now = now_iso_utc();
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM budgets WHERE type_id = ?1 AND month = ?2 AND deleted_at IS NULL",
                params![type_id, month],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?;

        if let Some(id) = existing {
            tx.execute(
                "UPDATE budgets SET allocated = ?1, updated_at = ?2 WHERE id = ?3",
                params![allocated, now, id],
            )
            .map_err(map_sqlite_error)?;
        } else {
            let id = OperationId::generate().as_str().to_string();
            tx.execute(
                "INSERT INTO budgets (id, type_id, month, allocated, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, type_id, month, allocated, now, now],
            )
            .map_err(map_sqlite_error)?;
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Copy allocations from the previous month into `target_month`.
/// Idempotent: re-running overwrites existing allocations.
pub fn copy_from_previous_month(
    conn: &mut Connection,
    op_id: OperationId,
    target_month: &str,
) -> DbResult<()> {
    let prev = previous_month(target_month)?;

    // Collect the previous budgets first (immutable borrow ends here).
    let prev_budgets: Vec<(String, i64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT type_id, allocated FROM budgets WHERE month = ?1 AND deleted_at IS NULL",
            )
            .map_err(map_sqlite_error)?;
        let rows: Vec<(String, i64)> = stmt
            .query_map(params![prev], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;
        rows
    };

    // Now mutate: each set_allocation uses its own run_idempotent.
    for (type_id, allocated) in &prev_budgets {
        let sub_op = OperationId::generate();
        set_allocation(conn, sub_op, type_id, target_month, *allocated)?;
    }

    // Wrap the whole copy in a single idempotent receipt.
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Copied { count: usize }
    let _ = run_idempotent(conn, op_id, "copy_from_previous", &target_month.to_string(), |_tx| {
        Ok(Copied { count: prev_budgets.len() })
    })?;

    Ok(())
}

/// Check if any allocations exist for a given month.
pub fn has_allocations(conn: &Connection, month: &str) -> DbResult<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM budgets WHERE month = ?1 AND deleted_at IS NULL",
            [month],
            |r| r.get(0),
        )
        .map_err(map_sqlite_error)?;
    Ok(count > 0)
}
