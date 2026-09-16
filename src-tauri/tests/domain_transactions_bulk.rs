//! Integration tests for the bulk transaction commands and the frequent-payee
//! strip — the four commands the client invoked but Rust never registered.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{accounts, transactions};
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    AccountType, NewAccount, NewTransaction, OperationId, TransactionKind,
};

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("notchy-bulk-test-{}", nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(format!("{}.sqlite", tag))
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn op() -> OperationId {
    OperationId::generate()
}

fn account(conn: &mut Connection, name: &str) -> String {
    accounts::create_account(
        conn,
        op(),
        NewAccount {
            name: name.to_string(),
            account_type: AccountType::Checking,
            counterparty: None,
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    )
    .unwrap()
}

fn expense(account_id: &str, payee: &str, amount: i64, date: &str) -> NewTransaction {
    NewTransaction {
        kind: TransactionKind::Expense,
        date: date.to_string(),
        amount,
        account_id: account_id.to_string(),
        transfer_account_id: None,
        refund_of_id: None,
        tag_id: None,
        payee: Some(payee.to_string()),
        description: None,
    }
}

#[test]
fn frequent_returns_the_most_repeated_payees_since_a_date() {
    let mut conn = fresh_db("frequent");
    let account = account(&mut conn, "A");

    for _ in 0..3 {
        transactions::create_transaction(
            &mut conn,
            op(),
            expense(&account, "Coffee", 5_000, "2026-02-01"),
        )
        .unwrap();
    }
    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Rent", 900_000, "2026-02-02"),
    )
    .unwrap();
    // Before the window.
    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Old", 1_000, "2025-01-01"),
    )
    .unwrap();

    let rows = transactions::get_frequent(&conn, "2026-01-01").unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].payee.as_deref(), Some("Coffee"));
    assert_eq!(rows[0].count, 3);
    assert_eq!(rows[1].payee.as_deref(), Some("Rent"));
}

#[test]
fn frequent_ignores_soft_deleted_transactions() {
    let mut conn = fresh_db("frequent-deleted");
    let account = account(&mut conn, "A");

    transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Coffee", 5_000, "2026-02-01"),
    )
    .unwrap();
    let dropped = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Coffee", 5_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transaction(&mut conn, op(), &dropped).unwrap();

    let rows = transactions::get_frequent(&conn, "2026-01-01").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].count, 1);
}
