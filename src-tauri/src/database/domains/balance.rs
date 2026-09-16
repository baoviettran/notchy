//! One place that knows how a transaction row maps to an account balance.
//!
//! `account_balance_as_of` is the body of `accounts::get_balance`, moved here
//! unchanged. The same expression was copy-pasted into `goals::get_balance`,
//! `debts::get_balance`, `reconciliations::get_balance`, and the per-account
//! loop in `reports::get_net_worth_series`. Five copies of a sign convention is
//! five chances to disagree about whether a refund is positive.

use rusqlite::{Connection, params};

use crate::database::error::{DbResult, map_sqlite_error};

/// Signed balance of one account as of `as_of`, inclusive.
///
/// Both directions of a transfer are counted, because the ledger of an account
/// shows transfers where it is either party (single-row transfer model:
/// `account_id` is the source, `transfer_account_id` the destination).
pub fn account_balance_as_of(conn: &Connection, account_id: &str, as_of: &str) -> DbResult<i64> {
    conn.query_row(
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
        params![account_id, as_of],
        |row| row.get(0),
    )
    .map_err(map_sqlite_error)
}

/// Signed net worth across every live account as of `as_of`, inclusive.
///
/// One query rather than one per account. The join reproduces the per-account
/// loop exactly: a row is counted once per live account it touches, so a
/// transfer between two live accounts contributes -amount and +amount and nets
/// to zero, while a transfer into a deleted account still counts its source.
pub fn net_worth_as_of(conn: &Connection, as_of: &str) -> DbResult<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(CASE
            WHEN t.kind = 'expense' THEN -t.amount
            WHEN t.kind = 'transfer' AND t.account_id = a.id THEN -t.amount
            WHEN t.kind = 'transfer' AND t.transfer_account_id = a.id THEN t.amount
            WHEN t.kind IN ('income', 'adjustment', 'refund') THEN t.amount
            ELSE 0
        END), 0)
        FROM transactions t
        JOIN accounts a
          ON a.deleted_at IS NULL
         AND (a.id = t.account_id OR (t.kind = 'transfer' AND a.id = t.transfer_account_id))
        WHERE t.deleted_at IS NULL AND t.date <= ?1",
        params![as_of],
        |row| row.get(0),
    )
    .map_err(map_sqlite_error)
}
