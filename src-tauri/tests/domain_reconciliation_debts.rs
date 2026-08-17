//! Integration tests for the reconciliation and debt domain services.

use std::path::PathBuf;

use notchy_lib::database::domains::{debts, reconciliations};
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{OperationId};
use rusqlite::{Connection, OpenFlags};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tid = std::thread::current().id();
    let dir = std::env::temp_dir()
        .join(format!("notchy-recon-debt-{}-{:?}-{}", tag, tid, nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(format!("{}.sqlite", tag))
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn seed_account(conn: &Connection, id: &str, name: &str, acc_type: &str) {
    conn.execute(
        "INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        rusqlite::params![id, name, acc_type],
    )
    .unwrap();
}

fn seed_tx(conn: &Connection, id: &str, kind: &str, amount: i64, account_id: &str, date: &str) {
    conn.execute(
        "INSERT INTO transactions (id, kind, date, amount, account_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        rusqlite::params![id, kind, date, amount, account_id],
    )
    .unwrap();
}

fn tx_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM transactions WHERE deleted_at IS NULL", [], |r| r.get(0))
        .unwrap()
}

// ---------------------------------------------------------------------------
// Reconciliation tests
// ---------------------------------------------------------------------------

#[test]
fn recon_history_empty_when_no_reconciliations() {
    let conn = fresh_db("recon-empty");
    let list = reconciliations::get_reconciliation_history(&conn, "acct_001").unwrap();
    assert!(list.is_empty());
}

#[test]
fn reconcile_with_no_adjustment() {
    let conn = fresh_db("recon-no-adj");
    seed_account(&conn, "acct_001", "Cash", "checking");
    seed_tx(&conn, "txn_001", "income", 500_000, "acct_001", "2026-07-01");

    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = reconciliations::reconcile(
        &mut conn, op_id, "acct_001", 500_000, false, Some("Looks good".into()),
    )
    .unwrap();

    assert_eq!(result.discrepancy, 0);
    assert!(result.adjustment_transaction_id.is_none());
    assert!(!result.reconciliation_id.is_empty());

    // Audit record created.
    let hist = reconciliations::get_reconciliation_history(&conn, "acct_001").unwrap();
    assert_eq!(hist.len(), 1);
    assert_eq!(hist[0].expected_balance, 500_000);
    assert_eq!(hist[0].actual_balance, 500_000);
    assert_eq!(hist[0].notes.as_deref(), Some("Looks good"));
}

#[test]
fn reconcile_with_positive_adjustment() {
    let conn = fresh_db("recon-pos-adj");
    seed_account(&conn, "acct_001", "Cash", "checking");
    seed_tx(&conn, "txn_001", "income", 100_000, "acct_001", "2026-07-01");

    // DB shows 100k but user reports 120k.
    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = reconciliations::reconcile(
        &mut conn, op_id, "acct_001", 120_000, true, None,
    )
    .unwrap();

    assert_eq!(result.discrepancy, 20_000);
    assert!(result.adjustment_transaction_id.is_some());

    // Adjustment transaction created.
    assert_eq!(tx_count(&conn), 2); // original + adjustment
}

#[test]
fn reconcile_with_negative_adjustment_creates_expense() {
    let conn = fresh_db("recon-neg-adj");
    seed_account(&conn, "acct_001", "Cash", "checking");
    seed_tx(&conn, "txn_001", "income", 100_000, "acct_001", "2026-07-01");

    // DB shows 100k but user reports 80k.
    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = reconciliations::reconcile(
        &mut conn, op_id, "acct_001", 80_000, true, None,
    )
    .unwrap();

    assert_eq!(result.discrepancy, -20_000);
    let adj_id = result.adjustment_transaction_id.as_ref().unwrap();
    // Check it's an expense.
    let kind: String = conn
        .query_row("SELECT kind FROM transactions WHERE id = ?1", [adj_id], |r| r.get(0))
        .unwrap();
    assert_eq!(kind, "expense");
}

#[test]
fn reconcile_idempotent_on_same_op_id() {
    let conn = fresh_db("recon-idempotent");
    seed_account(&conn, "acct_001", "Cash", "checking");
    seed_tx(&conn, "txn_001", "income", 500_000, "acct_001", "2026-07-01");

    let op_id = OperationId::generate();
    let mut conn = conn;
    let r1 = reconciliations::reconcile(
        &mut conn, op_id.clone(), "acct_001", 520_000, true, None,
    )
    .unwrap();
    let r2 = reconciliations::reconcile(
        &mut conn, op_id, "acct_001", 520_000, true, None,
    )
    .unwrap();

    // Same op_id returns same result, no extra rows.
    assert_eq!(r1.reconciliation_id, r2.reconciliation_id);
    assert_eq!(tx_count(&conn), 2); // original + 1 adjustment
}

#[test]
fn large_discrepancy_flag() {
    assert!(!reconciliations::is_large_discrepancy(999_999));
    assert!(reconciliations::is_large_discrepancy(1_000_001));
    assert!(reconciliations::is_large_discrepancy(-1_000_001));
}

#[test]
fn reconcile_multiple_history_entries_ordered() {
    let conn = fresh_db("recon-history");
    seed_account(&conn, "acct_001", "Cash", "checking");
    seed_tx(&conn, "txn_001", "income", 500_000, "acct_001", "2026-07-01");

    let mut conn = conn;
    let op1 = OperationId::generate();
    reconciliations::reconcile(&mut conn, op1, "acct_001", 500_000, false, None).unwrap();
    let op2 = OperationId::generate();
    reconciliations::reconcile(&mut conn, op2, "acct_001", 500_000, false, None).unwrap();

    let hist = reconciliations::get_reconciliation_history(&conn, "acct_001").unwrap();
    assert_eq!(hist.len(), 2);
    // Most recent first.
    assert!(hist[0].date >= hist[1].date);
}

#[test]
fn reconcile_nonexistent_account_returns_invalid_input() {
    let conn = fresh_db("recon-no-acct");
    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = reconciliations::reconcile(&mut conn, op_id, "nonexistent", 100_000, false, None);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// Debt tests
// ---------------------------------------------------------------------------

#[test]
fn list_debts_empty() {
    let conn = fresh_db("debts-empty");
    let summary = debts::list_debts(&conn).unwrap();
    assert!(summary.i_owe.is_empty());
    assert!(summary.owed_to_me.is_empty());
}

#[test]
fn list_debts_splits_by_type() {
    let conn = fresh_db("debts-split");
    seed_account(&conn, "loan_to_001", "John owes me", "loan_to_person");
    seed_account(&conn, "loan_from_001", "I owe Jane", "loan_from_person");
    // Regular account should be ignored.
    seed_account(&conn, "chk_001", "Main account", "checking");

    let summary = debts::list_debts(&conn).unwrap();
    assert_eq!(summary.owed_to_me.len(), 1);
    assert_eq!(summary.owed_to_me[0].name, "John owes me");
    assert_eq!(summary.i_owe.len(), 1);
    assert_eq!(summary.i_owe[0].name, "I owe Jane");
}

#[test]
fn list_debts_computes_balance() {
    let conn = fresh_db("debts-balance");
    seed_account(&conn, "loan_to_001", "John owes me", "loan_to_person");
    // John borrowed 500k.
    seed_tx(&conn, "txn_001", "expense", 500_000, "loan_to_001", "2026-07-01");
    // John repaid 200k.
    seed_tx(&conn, "txn_002", "income", 200_000, "loan_to_001", "2026-07-15");

    let summary = debts::list_debts(&conn).unwrap();
    assert_eq!(summary.owed_to_me.len(), 1);
    assert_eq!(summary.owed_to_me[0].balance, -300_000);
}

#[test]
fn write_off_loan_to_person_creates_expense() {
    let conn = fresh_db("debts-writeoff-to");
    seed_account(&conn, "loan_to_001", "John owes me", "loan_to_person");
    seed_account(&conn, "chk_001", "Main", "checking");
    seed_tx(&conn, "txn_001", "expense", 500_000, "loan_to_001", "2026-07-01");

    let mut conn = conn;
    let op_id = OperationId::generate();
    let txn_id = debts::write_off(&mut conn, op_id, "loan_to_001", 500_000, "tag_loss").unwrap();
    assert!(!txn_id.is_empty());

    let kind: String = conn
        .query_row("SELECT kind FROM transactions WHERE id = ?1", [&txn_id], |r| r.get(0))
        .unwrap();
    assert_eq!(kind, "expense");
}

#[test]
fn write_off_loan_from_person_creates_income() {
    let conn = fresh_db("debts-writeoff-from");
    seed_account(&conn, "loan_from_001", "I owe Jane", "loan_from_person");
    seed_account(&conn, "chk_001", "Main", "checking");

    let mut conn = conn;
    let op_id = OperationId::generate();
    let txn_id = debts::write_off(&mut conn, op_id, "loan_from_001", 300_000, "tag_gift").unwrap();

    let kind: String = conn
        .query_row("SELECT kind FROM transactions WHERE id = ?1", [&txn_id], |r| r.get(0))
        .unwrap();
    assert_eq!(kind, "income");
}

#[test]
fn write_off_nonexistent_account_returns_error() {
    let conn = fresh_db("debts-writeoff-none");
    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = debts::write_off(&mut conn, op_id, "nonexistent", 100_000, "tag_gift");
    assert!(result.is_err());
}

#[test]
fn write_off_non_loan_account_returns_error() {
    let conn = fresh_db("debts-writeoff-chk");
    seed_account(&conn, "chk_001", "Main", "checking");
    let mut conn = conn;
    let op_id = OperationId::generate();
    let result = debts::write_off(&mut conn, op_id, "chk_001", 100_000, "tag_gift");
    assert!(result.is_err());
}

#[test]
fn list_debts_includes_last_activity() {
    let conn = fresh_db("debts-activity");
    seed_account(&conn, "loan_to_001", "John", "loan_to_person");
    seed_tx(&conn, "txn_001", "expense", 100_000, "loan_to_001", "2026-06-15");
    seed_tx(&conn, "txn_002", "income", 50_000, "loan_to_001", "2026-07-20");

    let summary = debts::list_debts(&conn).unwrap();
    assert_eq!(summary.owed_to_me.len(), 1);
    assert_eq!(summary.owed_to_me[0].last_activity.as_deref(), Some("2026-07-20"));
}

#[test]
fn list_debts_sorted_by_last_activity() {
    let conn = fresh_db("debts-sort");
    seed_account(&conn, "loan_to_001", "John", "loan_to_person");
    seed_account(&conn, "loan_to_002", "Bob", "loan_to_person");
    seed_tx(&conn, "txn_001", "expense", 100_000, "loan_to_001", "2026-07-01");
    seed_tx(&conn, "txn_002", "expense", 100_000, "loan_to_002", "2026-07-15");

    let summary = debts::list_debts(&conn).unwrap();
    assert_eq!(summary.owed_to_me[0].name, "Bob");
    assert_eq!(summary.owed_to_me[1].name, "John");
}
