//! Reconciliation domain service — ported from `src/lib/db/repos/reconciliations.ts`.
//!
//! Atomic reconcile-with-adjustment: balance read, optional adjustment
//! transaction, and audit record all commit inside one `BEGIN IMMEDIATE`.

use rusqlite::{Connection, params};

use crate::database::error::{DbResult, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{OperationId, ReconcileResult, Reconciliation};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the balance for an account as of today (same formula as accounts domain).
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

/// Large-discrepancy threshold — matching the frontend constant.
pub const LARGE_DISCREPANCY_THRESHOLD: i64 = 1_000_000;

/// Check if a discrepancy exceeds the large-discrepancy threshold.
pub fn is_large_discrepancy(discrepancy: i64) -> bool {
    discrepancy.abs() > LARGE_DISCREPANCY_THRESHOLD
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Get reconciliation history for an account, most recent first.
pub fn get_reconciliation_history(
    conn: &Connection,
    account_id: &str,
) -> DbResult<Vec<Reconciliation>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, account_id, date, expected_balance, actual_balance,
                    adjustment_transaction_id, notes, created_at, updated_at
             FROM reconciliations
             WHERE account_id = ?1 AND deleted_at IS NULL
             ORDER BY date DESC",
        )
        .map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map(params![account_id], |row| {
            Ok(Reconciliation {
                id: row.get(0)?,
                account_id: row.get(1)?,
                date: row.get(2)?,
                expected_balance: row.get(3)?,
                actual_balance: row.get(4)?,
                adjustment_transaction_id: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(map_sqlite_error)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite_error)?);
    }
    Ok(out)
}

/// Reconcile an account. Atomic: adjustment transaction + audit record commit together.
///
/// `create_adjustment`: if true and discrepancy != 0, insert an adjustment/expense
/// transaction to bring balance in line with `actual_balance`.
pub fn reconcile(
    conn: &mut Connection,
    op_id: OperationId,
    account_id: &str,
    actual_balance: i64,
    create_adjustment: bool,
    notes: Option<String>,
) -> DbResult<ReconcileResult> {
    let expected_balance = get_balance(conn, account_id)?;
    let discrepancy = actual_balance - expected_balance;

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Reconciled {
        reconciliation_id: String,
        adjustment_transaction_id: Option<String>,
    }

    let result = run_idempotent(
        conn,
        op_id,
        "reconcile",
        &(&account_id, &actual_balance, &create_adjustment),
        |tx| {
            let now = now_iso_utc();
            let today = &now[..10];
            let recon_id = OperationId::generate().as_str().to_string();

            let adj_id = if create_adjustment && discrepancy != 0 {
                let txn_id = OperationId::generate().as_str().to_string();
                let kind = if discrepancy > 0 {
                    "adjustment"
                } else {
                    "expense"
                };
                tx.execute(
                    "INSERT INTO transactions \
                     (id, kind, date, amount, account_id, tag_id, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, 'tag_reconciliation', ?6, ?7)",
                    params![txn_id, kind, today, discrepancy.abs(), account_id, now, now],
                )
                .map_err(map_sqlite_error)?;
                Some(txn_id)
            } else {
                None
            };

            tx.execute(
                "INSERT INTO reconciliations \
                 (id, account_id, date, expected_balance, actual_balance, \
                  adjustment_transaction_id, notes, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    recon_id,
                    account_id,
                    today,
                    expected_balance,
                    actual_balance,
                    adj_id,
                    notes,
                    now,
                    now,
                ],
            )
            .map_err(map_sqlite_error)?;

            Ok(Reconciled {
                reconciliation_id: recon_id,
                adjustment_transaction_id: adj_id,
            })
        },
    )?;

    Ok(ReconcileResult {
        discrepancy,
        reconciliation_id: result.reconciliation_id,
        adjustment_transaction_id: result.adjustment_transaction_id,
    })
}
