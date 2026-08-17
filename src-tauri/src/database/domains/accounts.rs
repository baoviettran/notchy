//! Account domain service — ported from `src/lib/db/repos/accounts.ts`.
//!
//! Read-only operations query directly; mutations go through `run_idempotent`.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{
    AccountPatch, AccountType, AccountWithBalance, NewAccount, OperationId,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Row mapper: positional columns from the accounts table.
fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountWithBalance> {
    let type_str: String = row.get(2)?;
    let account_type = match type_str.as_str() {
        "checking" => AccountType::Checking,
        "savings" => AccountType::Savings,
        "cash" => AccountType::Cash,
        "credit_card" => AccountType::CreditCard,
        "loan_to_person" => AccountType::LoanToPerson,
        "loan_from_person" => AccountType::LoanFromPerson,
        _ => AccountType::Checking, // unreachable for valid data
    };
    Ok(AccountWithBalance {
        id: row.get(0)?,
        name: row.get(1)?,
        account_type,
        counterparty: row.get(3)?,
        currency: row.get(4)?,
        archived: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        balance: row.get(8)?,
    })
}

/// Today's date as `YYYY-MM-DD` from the system clock (UTC).
pub(crate) fn today_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
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
    format!("{yr:04}-{m:02}-{d:02}")
}

fn validate_type_change(from: AccountType, to: AccountType) -> DbResult<()> {
    if from.is_asset() != to.is_asset() {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }
    if from.is_loan() || to.is_loan() {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }
    Ok(())
}

fn enforce_single_currency(conn: &Connection, currency: &str) -> DbResult<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT currency FROM accounts WHERE deleted_at IS NULL LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?;
    if let Some(c) = existing {
        if c != currency {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
    }
    Ok(())
}

/// Compute the balance for one account as of `date` (inclusive).
fn get_balance(conn: &Connection, account_id: &str, date: &str) -> DbResult<i64> {
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
            params![account_id, date],
            |row| row.get(0),
        )
        .map_err(map_sqlite_error)?;
    Ok(total)
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

/// List all non-deleted accounts with computed balance (as of today).
///
/// Uses the UNION ALL balance pattern from the TypeScript source to scan the
/// transactions table a single time instead of a correlated subquery per account.
pub fn list_accounts(conn: &Connection) -> DbResult<Vec<AccountWithBalance>> {
    let today = today_iso();
    let mut stmt = conn
        .prepare(
            "SELECT
                a.id, a.name, a.type, a.counterparty, a.currency,
                a.archived, a.created_at, a.updated_at,
                COALESCE(b.balance, 0) AS balance
            FROM accounts a
            LEFT JOIN (
                SELECT acct_id, SUM(delta) AS balance
                FROM (
                    SELECT account_id AS acct_id,
                        CASE
                            WHEN kind = 'income' THEN amount
                            WHEN kind = 'adjustment' THEN amount
                            WHEN kind = 'refund' THEN amount
                            WHEN kind = 'expense' THEN -amount
                            WHEN kind = 'transfer' THEN -amount
                            ELSE 0
                        END AS delta
                    FROM transactions
                    WHERE deleted_at IS NULL AND date <= ?1
                    UNION ALL
                    SELECT transfer_account_id AS acct_id, amount AS delta
                    FROM transactions
                    WHERE kind = 'transfer' AND deleted_at IS NULL AND date <= ?1
                )
                GROUP BY acct_id
            ) b ON a.id = b.acct_id
            WHERE a.deleted_at IS NULL
            ORDER BY a.archived, a.created_at",
        )
        .map_err(map_sqlite_error)?;

    let rows = stmt
        .query_map(params![today], row_to_account)
        .map_err(map_sqlite_error)?;

    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(map_sqlite_error)?);
    }
    Ok(accounts)
}

/// Get a single non-deleted account by ID with computed balance.
pub fn get_account(conn: &Connection, id: &str) -> DbResult<Option<AccountWithBalance>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, type, counterparty, currency, archived, created_at, updated_at
             FROM accounts WHERE id = ?1 AND deleted_at IS NULL",
        )
        .map_err(map_sqlite_error)?;

    let mut rows = stmt.query_map(params![id], |row| {
        let type_str: String = row.get(2)?;
        let account_type = match type_str.as_str() {
            "checking" => AccountType::Checking,
            "savings" => AccountType::Savings,
            "cash" => AccountType::Cash,
            "credit_card" => AccountType::CreditCard,
            "loan_to_person" => AccountType::LoanToPerson,
            "loan_from_person" => AccountType::LoanFromPerson,
            _ => AccountType::Checking,
        };
        Ok(AccountWithBalance {
            id: row.get(0)?,
            name: row.get(1)?,
            account_type,
            counterparty: row.get(3)?,
            currency: row.get(4)?,
            archived: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            balance: 0, // placeholder; computed below
        })
    }).map_err(map_sqlite_error)?;

    let Some(row) = rows.next() else { return Ok(None) };
    let mut acct = row.map_err(map_sqlite_error)?;
    let today = today_iso();
    acct.balance = get_balance(conn, &acct.id, &today)?;
    Ok(Some(acct))
}

// ---------------------------------------------------------------------------
// Mutations (via `run_idempotent`)
// ---------------------------------------------------------------------------

/// Create a new account, optionally with an opening-balance transaction.
///
/// Liability types (`credit_card`, `loan_from_person`) record the opening
/// balance as an `expense`; asset types use `adjustment`.
pub fn create_account(
    conn: &mut Connection,
    op_id: OperationId,
    input: NewAccount,
) -> DbResult<String> {
    // Validate counterparty required for loan types.
    if input.account_type.is_loan() && input.counterparty.as_deref().unwrap_or("").is_empty() {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }

    // Single-currency rule: must match existing accounts.
    enforce_single_currency(conn, &input.currency)?;

    #[derive(serde::Serialize, serde::Deserialize)]
    struct AccountCreated {
        account_id: String,
    }

    run_idempotent(conn, op_id, "create_account", &input, |tx| {
        let now = now_iso_utc();
        let account_id = OperationId::generate();
        let id = account_id.as_str().to_string();

        tx.execute(
            "INSERT INTO accounts (id, name, type, counterparty, currency, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                input.name,
                input.account_type.as_str(),
                input.counterparty,
                input.currency,
                now,
                now,
            ],
        )
        .map_err(map_sqlite_error)?;

        // Create initial balance transaction if provided.
        if let Some(balance) = input.initial_balance {
            if balance != 0 {
                let tx_id = OperationId::generate().as_str().to_string();
                let date = input
                    .initial_balance_date
                    .clone()
                    .unwrap_or_else(|| now[..10].to_string());
                let kind = if input.account_type.is_liability() {
                    "expense"
                } else {
                    "adjustment"
                };
                tx.execute(
                    "INSERT INTO transactions \
                     (id, kind, date, amount, account_id, tag_id, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, ?4, ?5, 'tag_initial_balance', ?6, ?7)",
                    params![tx_id, kind, date, balance.abs(), id, now, now],
                )
                .map_err(map_sqlite_error)?;
            }
        }

        Ok(AccountCreated { account_id: id })
    })
    .map(|r| r.account_id)
}

/// Update an existing account (partial patch).
pub fn update_account(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    patch: AccountPatch,
) -> DbResult<()> {
    // Fetch existing account for validation.
    let existing = get_account(conn, id)?.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;

    // Validate type change rules.
    if let Some(new_type) = patch.account_type {
        if new_type != existing.account_type {
            validate_type_change(existing.account_type, new_type)?;
        }
    }

    // Counterparty required for loan types.
    let effective_type = patch.account_type.unwrap_or(existing.account_type);
    if effective_type.is_loan() {
        let effective_cp = match &patch.counterparty {
            crate::database::types::Patch::Replace { value } => Some(value.as_str()),
            crate::database::types::Patch::ExplicitNull => None,
            crate::database::types::Patch::Omitted => existing.counterparty.as_deref(),
        };
        if effective_cp.unwrap_or("").is_empty() {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
    }

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "update_account", &patch, |tx| {
        let now = now_iso_utc();
        let mut sets = vec!["updated_at = ?".to_string()];
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];

        if let Some(ref name) = patch.name {
            sets.push(format!("name = ?", ));
            values.push(Box::new(name.clone()));
        }
        if let Some(at) = patch.account_type {
            sets.push("type = ?".to_string());
            values.push(Box::new(at.as_str().to_string()));
        }
        match &patch.counterparty {
            crate::database::types::Patch::Replace { value } => {
                sets.push("counterparty = ?".to_string());
                values.push(Box::new(value.clone()));
            }
            crate::database::types::Patch::ExplicitNull => {
                sets.push("counterparty = ?".to_string());
                values.push(Box::new(rusqlite::types::Null));
            }
            crate::database::types::Patch::Omitted => {}
        }
        if let Some(archived) = patch.archived {
            sets.push("archived = ?".to_string());
            values.push(Box::new(archived));
        }

        values.push(Box::new(id.to_string()));
        let sql = format!("UPDATE accounts SET {} WHERE id = ?", sets.join(", "));
        tx.execute(&sql, rusqlite::params_from_iter(values.as_slice()))
            .map_err(map_sqlite_error)?;

        Ok(Void {})
    })
    .map(|_| ())
}

/// Soft-delete an account. Blocks if any active goal links to it.
pub fn delete_account(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    // Verify account exists.
    let _existing = get_account(conn, id)?.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "delete_account", &id.to_string(), |tx| {
        // Block if any active goal links to this account.
        let mut stmt = tx
            .prepare("SELECT name FROM goals WHERE linked_account_id = ?1 AND deleted_at IS NULL AND status = 'active'")
            .map_err(map_sqlite_error)?;
        let mut rows = stmt.query(params![id]).map_err(map_sqlite_error)?;
        if rows.next().map_err(map_sqlite_error)?.is_some() {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        let now = now_iso_utc();
        tx.execute(
            "UPDATE accounts SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![now, now, id],
        )
        .map_err(map_sqlite_error)?;

        Ok(Void {})
    })
    .map(|_| ())
}
