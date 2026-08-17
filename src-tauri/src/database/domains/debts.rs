//! Debt domain service — ported from `src/lib/db/repos/debts.ts`.
//!
//! Lists loan accounts split by direction, and performs write-off transactions.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{DebtAccount, DebtSummary, OperationId};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the balance for an account as of today.
fn get_balance(conn: &Connection, account_id: &str) -> DbResult<i64> {
    let today = crate::database::domains::accounts::today_iso();
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// List all active loan accounts, split by direction.
pub fn list_debts(conn: &Connection) -> DbResult<DebtSummary> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, type, COALESCE(counterparty, '') FROM accounts
             WHERE type IN ('loan_to_person', 'loan_from_person')
               AND deleted_at IS NULL AND archived = 0",
        )
        .map_err(map_sqlite_error)?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(map_sqlite_error)?;

    let mut i_owe = Vec::new();
    let mut owed_to_me = Vec::new();

    for row in rows {
        let (id, name, acc_type, counterparty) = row.map_err(map_sqlite_error)?;
        let balance = get_balance(conn, &id)?;

        // Most recent transaction date.
        let last_activity: Option<String> = conn
            .query_row(
                "SELECT date FROM transactions WHERE account_id = ?1 AND deleted_at IS NULL ORDER BY date DESC LIMIT 1",
                [&id],
                |r| r.get(0),
            )
            .optional()
            .map_err(map_sqlite_error)?;

        let debt = DebtAccount {
            id,
            name,
            r#type: acc_type.clone(),
            counterparty,
            balance,
            last_activity,
        };

        if acc_type == "loan_from_person" {
            i_owe.push(debt);
        } else {
            owed_to_me.push(debt);
        }
    }

    // Sort by last_activity descending (most recent first).
    let by_activity = |a: &DebtAccount, b: &DebtAccount| {
        (b.last_activity.as_deref().unwrap_or(""))
            .cmp(a.last_activity.as_deref().unwrap_or(""))
    };
    i_owe.sort_by(&by_activity);
    owed_to_me.sort_by(&by_activity);

    Ok(DebtSummary { i_owe, owed_to_me })
}

/// Write off a debt amount. Creates an expense (loan_to_person) or
/// income (loan_from_person) transaction. Returns the new transaction ID.
pub fn write_off(
    conn: &mut Connection,
    op_id: OperationId,
    account_id: &str,
    amount: i64,
    tag_id: &str,
) -> DbResult<String> {
    // Validate account exists and is a loan type.
    let acc_type: Option<String> = conn
        .query_row(
            "SELECT type FROM accounts WHERE id = ?1 AND deleted_at IS NULL",
            [account_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?;
    let acc_type = acc_type.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;

    // Only loan accounts can be written off.
    if acc_type != "loan_to_person" && acc_type != "loan_from_person" {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }

    // loan_to_person write-off = expense (we lose money).
    // loan_from_person write-off = income (debt forgiven to us).
    let kind = if acc_type == "loan_to_person" {
        "expense"
    } else {
        "income"
    };

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Created { id: String }

    run_idempotent(conn, op_id, "write_off", &(&account_id, &amount, &tag_id), |tx| {
        let now = now_iso_utc();
        let today = &now[..10];
        let id = OperationId::generate().as_str().to_string();
        tx.execute(
            "INSERT INTO transactions \
             (id, kind, date, amount, account_id, tag_id, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, kind, today, amount, account_id, tag_id, now, now],
        )
        .map_err(map_sqlite_error)?;
        Ok(Created { id })
    })
    .map(|r| r.id)
}
