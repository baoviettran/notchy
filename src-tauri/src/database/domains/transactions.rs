//! Transaction domain service — ported from `src/lib/db/repos/transactions.ts`.
//!
//! Read-only operations query directly; mutations go through `run_idempotent`.
//! Single-row transfer model: `account_id` = source, `transfer_account_id` = dest.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{
    NewTransaction, OperationId, Patch, Transaction, TransactionFilter, TransactionKind,
    TransactionPatch,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn row_to_transaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    let kind_str: String = row.get(1)?;
    let kind = match kind_str.as_str() {
        "expense" => TransactionKind::Expense,
        "income" => TransactionKind::Income,
        "transfer" => TransactionKind::Transfer,
        "refund" => TransactionKind::Refund,
        "adjustment" => TransactionKind::Adjustment,
        _ => TransactionKind::Expense, // unreachable for valid data
    };
    Ok(Transaction {
        id: row.get(0)?,
        kind,
        date: row.get(2)?,
        amount: row.get(3)?,
        account_id: row.get(4)?,
        transfer_account_id: row.get(5)?,
        transfer_pair_id: row.get(6)?,
        refund_of_id: row.get(7)?,
        tag_id: row.get(8)?,
        payee: row.get(9)?,
        description: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

/// Strip control characters from text, preserving `\n`, `\r`, `\t`.
///
/// Ported from `src/lib/utils/sanitize.ts`. Removes ASCII control chars
/// 0x00-0x1F and 0x7F except `\n` (0x0A), `\r` (0x0D), and `\t` (0x09).
fn strip_control_chars(input: &str) -> String {
    input
        .chars()
        .filter(|&c| {
            !c.is_control() || c == '\n' || c == '\r' || c == '\t'
        })
        .collect()
}

/// Escape special LIKE pattern characters (`%`, `_`, `\`).
fn escape_like(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for c in input.chars() {
        match c {
            '%' | '_' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Verify that an account exists and is not soft-deleted.
fn validate_account_exists(conn: &Connection, account_id: &str) -> DbResult<()> {
    let found: bool = conn
        .query_row(
            "SELECT 1 FROM accounts WHERE id = ?1 AND deleted_at IS NULL",
            params![account_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .is_some();
    if !found {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

/// List transactions with dynamic filters, ordered by date DESC.
///
/// Default limit: 50, default offset: 0.
pub fn list_transactions(
    conn: &Connection,
    filter: TransactionFilter,
) -> DbResult<Vec<Transaction>> {
    let mut conditions = vec!["t.deleted_at IS NULL".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref account_id) = filter.account_id {
        conditions
            .push("(t.account_id = ? OR (t.kind = 'transfer' AND t.transfer_account_id = ?))".to_string());
        param_values.push(Box::new(account_id.clone()));
        param_values.push(Box::new(account_id.clone()));
    }
    if let Some(kind) = filter.kind {
        conditions.push("t.kind = ?".to_string());
        param_values.push(Box::new(kind.as_str().to_string()));
    }
    if let Some(ref tag_id) = filter.tag_id {
        conditions.push("t.tag_id = ?".to_string());
        param_values.push(Box::new(tag_id.clone()));
    }
    if let Some(ref date_from) = filter.date_from {
        conditions.push("t.date >= ?".to_string());
        param_values.push(Box::new(date_from.clone()));
    }
    if let Some(ref date_to) = filter.date_to {
        conditions.push("t.date <= ?".to_string());
        param_values.push(Box::new(date_to.clone()));
    }
    if let Some(ref payee) = filter.payee {
        conditions.push("t.payee LIKE ? ESCAPE '\\'".to_string());
        param_values.push(Box::new(format!("%{}%", escape_like(payee))));
    }
    if let Some(ref query) = filter.query {
        conditions
            .push("(t.payee LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')".to_string());
        let q = format!("%{}%", escape_like(query));
        param_values.push(Box::new(q.clone()));
        param_values.push(Box::new(q));
    }

    let limit = filter.limit.unwrap_or(50) as i64;
    let offset = filter.offset.unwrap_or(0) as i64;

    let sql = format!(
        "SELECT id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, \
                refund_of_id, tag_id, payee, description, created_at, updated_at \
         FROM transactions t WHERE {} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?",
        conditions.join(" AND ")
    );
    param_values.push(Box::new(limit));
    param_values.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(param_values.as_slice()), row_to_transaction)
        .map_err(map_sqlite_error)?;

    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(row.map_err(map_sqlite_error)?);
    }
    Ok(transactions)
}

/// Get a single non-deleted transaction by ID.
pub fn get_transaction(conn: &Connection, id: &str) -> DbResult<Option<Transaction>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, \
                    refund_of_id, tag_id, payee, description, created_at, updated_at \
             FROM transactions WHERE id = ?1 AND deleted_at IS NULL",
        )
        .map_err(map_sqlite_error)?;

    let mut rows = stmt
        .query_map(params![id], row_to_transaction)
        .map_err(map_sqlite_error)?;

    match rows.next() {
        Some(row) => Ok(Some(row.map_err(map_sqlite_error)?)),
        None => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Mutations (via `run_idempotent`)
// ---------------------------------------------------------------------------

/// Create a single transaction. Handles transfers (single-row model) and
/// refunds (validates that the target is an existing non-deleted expense).
///
/// Validates that `account_id` exists and is not deleted.
pub fn create_transaction(
    conn: &mut Connection,
    op_id: OperationId,
    input: NewTransaction,
) -> DbResult<String> {
    validate_account_exists(conn, &input.account_id)?;

    // Transfers require a destination account that differs from the source.
    if input.kind == TransactionKind::Transfer {
        let dest = input
            .transfer_account_id
            .as_deref()
            .ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
        if dest == input.account_id {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        validate_account_exists(conn, dest)?;
    }

    let description = input
        .description
        .as_deref()
        .map(strip_control_chars);

    #[derive(serde::Serialize, serde::Deserialize)]
    struct TxnCreated {
        transaction_id: String,
    }

    run_idempotent(conn, op_id, "create_transaction", &input, |tx| {
        let now = now_iso_utc();
        let txn_id = OperationId::generate().as_str().to_string();

        if input.kind == TransactionKind::Transfer {
            // Single-row transfer model: one row, account_id = source,
            // transfer_account_id = dest, transfer_pair_id links the pair.
            let pair_id = OperationId::generate().as_str().to_string();
            tx.execute(
                "INSERT INTO transactions \
                 (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, \
                  created_at, updated_at) \
                 VALUES (?1, 'transfer', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    txn_id,
                    input.date,
                    input.amount,
                    input.account_id,
                    input.transfer_account_id,
                    pair_id,
                    now,
                    now,
                ],
            )
            .map_err(map_sqlite_error)?;
        } else {
            // Refunds: validate that the target is an existing non-deleted expense.
            if let Some(ref refund_id) = input.refund_of_id {
                let kind_str: String = tx
                    .query_row(
                        "SELECT kind FROM transactions WHERE id = ?1 AND deleted_at IS NULL",
                        params![refund_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| match e {
                        rusqlite::Error::QueryReturnedNoRows => {
                            DbError::new(ErrorCode::InvalidInput)
                        }
                        other => map_sqlite_error(other),
                    })?;
                if kind_str != "expense" {
                    return Err(DbError::new(ErrorCode::InvalidInput));
                }
            }

            tx.execute(
                "INSERT INTO transactions \
                 (id, kind, date, amount, account_id, refund_of_id, tag_id, payee, description, \
                  created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    txn_id,
                    input.kind.as_str(),
                    input.date,
                    input.amount,
                    input.account_id,
                    input.refund_of_id,
                    input.tag_id,
                    input.payee,
                    description,
                    now,
                    now,
                ],
            )
            .map_err(map_sqlite_error)?;
        }

        Ok(TxnCreated {
            transaction_id: txn_id,
        })
    })
    .map(|r| r.transaction_id)
}

/// Batch-create transactions (CSV/OFX import).
///
/// Only `expense` and `income` kinds are allowed; no refunds. Each row
/// validates that its `account_id` exists. All inserts run inside a single
/// `run_idempotent` receipt.
pub fn create_transactions_batch(
    conn: &mut Connection,
    op_id: OperationId,
    inputs: Vec<NewTransaction>,
) -> DbResult<Vec<String>> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }

    // Validate all inputs before entering run_idempotent.
    for input in &inputs {
        match input.kind {
            TransactionKind::Expense | TransactionKind::Income => {}
            _ => return Err(DbError::new(ErrorCode::InvalidInput)),
        }
        if input.refund_of_id.is_some() {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        validate_account_exists(conn, &input.account_id)?;
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct BatchResult {
        transaction_ids: Vec<String>,
    }

    run_idempotent(conn, op_id, "create_transactions_batch", &inputs, |tx| {
        let now = now_iso_utc();
        let mut ids = Vec::with_capacity(inputs.len());

        for input in &inputs {
            let txn_id = OperationId::generate().as_str().to_string();
            let description = input
                .description
                .as_deref()
                .map(strip_control_chars);

            tx.execute(
                "INSERT INTO transactions \
                 (id, kind, date, amount, account_id, refund_of_id, tag_id, payee, description, \
                  created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
                params![
                    txn_id,
                    input.kind.as_str(),
                    input.date,
                    input.amount,
                    input.account_id,
                    input.tag_id,
                    input.payee,
                    description,
                    now,
                    now,
                ],
            )
            .map_err(map_sqlite_error)?;

            ids.push(txn_id);
        }

        Ok(BatchResult {
            transaction_ids: ids,
        })
    })
    .map(|r| r.transaction_ids)
}

/// Update an existing transaction (partial patch).
///
/// Validates that the transaction exists. Rejects self-transfers when
/// `transfer_account_id` is changed to match `account_id`.
pub fn update_transaction(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    patch: TransactionPatch,
) -> DbResult<()> {
    let existing =
        get_transaction(conn, id)?.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;

    // Reject self-transfer on repoint.
    if let Some(ref dest) = patch.transfer_account_id {
        if *dest == existing.account_id {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
    }

    // Kind changes are the edit-mode repair path. Transfer conversions carry
    // column consequences (destination, pair id, refund link), so they are
    // validated and applied here — mirroring the TS repo's applyPatch.
    let changing_kind = matches!(&patch.kind, Some(new_kind) if *new_kind != existing.kind);
    let mut dest_handled = false;
    if changing_kind && patch.kind.as_ref() == Some(&TransactionKind::Transfer) {
        match patch
            .transfer_account_id
            .clone()
            .or_else(|| existing.transfer_account_id.clone())
        {
            Some(dest) if dest != existing.account_id => {
                validate_account_exists(conn, &dest)?;
                dest_handled = true;
            }
            _ => return Err(DbError::new(ErrorCode::InvalidInput)),
        }
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "update_transaction", &patch, |tx| {
        let now = now_iso_utc();
        let mut sets = vec!["updated_at = ?".to_string()];
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        if changing_kind {
            // Validated above; the transfer conversion also carries its
            // column consequences here.
            let new_kind = patch.kind.as_ref().expect("changing_kind implies kind");
            sets.push("kind = ?".to_string());
            values.push(Box::new(new_kind.as_str().to_string()));
            if *new_kind == TransactionKind::Transfer {
                let dest = patch
                    .transfer_account_id
                    .clone()
                    .or_else(|| existing.transfer_account_id.clone())
                    .expect("transfer destination validated above");
                sets.push("transfer_account_id = ?".to_string());
                values.push(Box::new(dest));
                sets.push("refund_of_id = NULL".to_string());
                if existing.transfer_pair_id.is_none() {
                    let pair_id = OperationId::generate().as_str().to_string();
                    sets.push("transfer_pair_id = ?".to_string());
                    values.push(Box::new(pair_id));
                }
            } else if existing.kind == TransactionKind::Transfer {
                sets.push("transfer_account_id = NULL".to_string());
                sets.push("transfer_pair_id = NULL".to_string());
            }
        }

        if let Some(ref date) = patch.date {
            sets.push("date = ?".to_string());
            values.push(Box::new(date.clone()));
        }
        if let Some(amount) = patch.amount {
            sets.push("amount = ?".to_string());
            values.push(Box::new(amount));
        }
        if let Some(ref dest) = patch.transfer_account_id {
            if !dest_handled {
                sets.push("transfer_account_id = ?".to_string());
                values.push(Box::new(dest.clone()));
            }
        }
        match &patch.tag_id {
            Patch::Replace { value } => {
                sets.push("tag_id = ?".to_string());
                values.push(Box::new(value.clone()));
            }
            Patch::ExplicitNull => {
                sets.push("tag_id = ?".to_string());
                values.push(Box::new(rusqlite::types::Null));
            }
            Patch::Omitted => {}
        }
        match &patch.payee {
            Patch::Replace { value } => {
                sets.push("payee = ?".to_string());
                values.push(Box::new(value.clone()));
            }
            Patch::ExplicitNull => {
                sets.push("payee = ?".to_string());
                values.push(Box::new(rusqlite::types::Null));
            }
            Patch::Omitted => {}
        }
        match &patch.description {
            Patch::Replace { value } => {
                sets.push("description = ?".to_string());
                values.push(Box::new(strip_control_chars(value)));
            }
            Patch::ExplicitNull => {
                sets.push("description = ?".to_string());
                values.push(Box::new(rusqlite::types::Null));
            }
            Patch::Omitted => {}
        }

        // No-op if only `updated_at` changed (mirrors TS behavior).
        if sets.len() == 1 {
            return Ok(Void {});
        }

        values.push(Box::new(id.to_string()));
        let sql = format!("UPDATE transactions SET {} WHERE id = ?", sets.join(", "));
        tx.execute(&sql, rusqlite::params_from_iter(values.as_slice()))
            .map_err(map_sqlite_error)?;

        Ok(Void {})
    })
    .map(|_| ())
}

/// Soft-delete a transaction.
pub fn delete_transaction(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    // Verify existence (including soft-deleted, to avoid double-delete).
    let existing = get_transaction(conn, id)?;
    if existing.is_none() {
        return Ok(()); // TS silently returns on not-found
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "delete_transaction", &id.to_string(), |tx| {
        let now = now_iso_utc();
        tx.execute(
            "UPDATE transactions SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![now, now, id],
        )
        .map_err(map_sqlite_error)?;
        Ok(Void {})
    })
    .map(|_| ())
}

/// Restore a soft-deleted transaction.
pub fn restore_transaction(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    // Must be currently soft-deleted.
    let found: bool = conn
        .query_row(
            "SELECT 1 FROM transactions WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
            |_| Ok(true),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .is_some();
    if !found {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "restore_transaction", &id.to_string(), |tx| {
        let now = now_iso_utc();
        tx.execute(
            "UPDATE transactions SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(map_sqlite_error)?;
        Ok(Void {})
    })
    .map(|_| ())
}

/// Duplicate an existing transaction: create a new `expense`/`income` row
/// with today's date and the same amount, account, tag, payee, and description.
///
/// If the original is a transfer, only the source side is copied (not a
/// transfer row — the caller should use the transfer creation flow instead).
pub fn duplicate_transaction(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<String> {
    let existing =
        get_transaction(conn, id)?.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;

    validate_account_exists(conn, &existing.account_id)?;

    // Compute today's ISO date.
    let now_duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now_duration.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };
    let today = format!("{yr:04}-{m:02}-{d:02}");

    let input = NewTransaction {
        kind: existing.kind,
        date: today,
        amount: existing.amount,
        account_id: existing.account_id,
        transfer_account_id: existing.transfer_account_id,
        refund_of_id: None,
        tag_id: existing.tag_id,
        payee: existing.payee,
        description: existing.description,
    };

    // Inline the create logic (cannot nest `run_idempotent` calls).
    let description = input
        .description
        .as_deref()
        .map(strip_control_chars);

    #[derive(serde::Serialize, serde::Deserialize)]
    struct TxnCreated {
        transaction_id: String,
    }

    run_idempotent(conn, op_id, "duplicate_transaction", &input, |tx| {
        let now = now_iso_utc();
        let txn_id = OperationId::generate().as_str().to_string();

        if input.kind == TransactionKind::Transfer {
            let pair_id = OperationId::generate().as_str().to_string();
            let dest = input
                .transfer_account_id
                .as_deref()
                .ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
            if dest == input.account_id {
                return Err(DbError::new(ErrorCode::InvalidInput));
            }
            tx.execute(
                "INSERT INTO transactions \
                 (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, \
                  created_at, updated_at) \
                 VALUES (?1, 'transfer', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    txn_id, input.date, input.amount, input.account_id,
                    input.transfer_account_id, pair_id, now, now,
                ],
            )
            .map_err(map_sqlite_error)?;
        } else {
            tx.execute(
                "INSERT INTO transactions \
                 (id, kind, date, amount, account_id, refund_of_id, tag_id, payee, description, \
                  created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    txn_id,
                    input.kind.as_str(),
                    input.date,
                    input.amount,
                    input.account_id,
                    input.refund_of_id,
                    input.tag_id,
                    input.payee,
                    description,
                    now,
                    now,
                ],
            )
            .map_err(map_sqlite_error)?;
        }

        Ok(TxnCreated {
            transaction_id: txn_id,
        })
    })
    .map(|r| r.transaction_id)
}
