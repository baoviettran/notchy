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

#[test]
fn delete_many_soft_deletes_exactly_the_selected_ids() {
    let mut conn = fresh_db("delete-many");
    let account = account(&mut conn, "A");

    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Keep", 1_000, "2026-02-01"),
    )
    .unwrap();
    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let b = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "B", 1_000, "2026-02-03"),
    )
    .unwrap();

    transactions::delete_transactions(&mut conn, op(), vec![a.clone(), b.clone()]).unwrap();

    assert!(transactions::get_transaction(&conn, &a).unwrap().is_none());
    assert!(transactions::get_transaction(&conn, &b).unwrap().is_none());
    assert!(transactions::get_transaction(&conn, &keep).unwrap().is_some());
}

#[test]
fn delete_many_leaves_already_deleted_rows_alone() {
    let mut conn = fresh_db("delete-many-idempotent");
    let account = account(&mut conn, "A");

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transactions(&mut conn, op(), vec![id.clone()]).unwrap();
    let first = transactions::get_transaction(&conn, &id).unwrap();
    assert!(first.is_none());

    // A second call must not error on the row it already soft-deleted.
    transactions::delete_transactions(&mut conn, op(), vec![id.clone()]).unwrap();
    assert!(transactions::get_transaction(&conn, &id).unwrap().is_none());
}

#[test]
fn delete_many_with_no_ids_is_a_no_op() {
    let mut conn = fresh_db("delete-many-empty");
    transactions::delete_transactions(&mut conn, op(), Vec::new()).unwrap();
}

#[test]
fn set_tag_many_retags_exactly_the_selected_ids() {
    let mut conn = fresh_db("set-tag-many");
    let account = account(&mut conn, "A");

    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let b = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "B", 1_000, "2026-02-03"),
    )
    .unwrap();
    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "Keep", 1_000, "2026-02-04"),
    )
    .unwrap();

    transactions::set_tag_many(
        &mut conn,
        op(),
        vec![a.clone(), b.clone()],
        Some("tag_loss".to_string()),
    )
    .unwrap();

    assert_eq!(
        transactions::get_transaction(&conn, &a).unwrap().unwrap().tag_id.as_deref(),
        Some("tag_loss")
    );
    assert_eq!(
        transactions::get_transaction(&conn, &b).unwrap().unwrap().tag_id.as_deref(),
        Some("tag_loss")
    );
    assert_eq!(
        transactions::get_transaction(&conn, &keep).unwrap().unwrap().tag_id,
        None
    );
}

#[test]
fn set_tag_many_can_clear_the_tag() {
    let mut conn = fresh_db("set-tag-many-null");
    let account = account(&mut conn, "A");

    let mut input = expense(&account, "A", 1_000, "2026-02-02");
    input.tag_id = Some("tag_loss".to_string());
    let id = transactions::create_transaction(&mut conn, op(), input).unwrap();

    transactions::set_tag_many(&mut conn, op(), vec![id.clone()], None).unwrap();

    assert_eq!(transactions::get_transaction(&conn, &id).unwrap().unwrap().tag_id, None);
}

#[test]
fn set_tag_many_skips_soft_deleted_rows() {
    let mut conn = fresh_db("set-tag-many-deleted");
    let account = account(&mut conn, "A");

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&account, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    transactions::delete_transaction(&mut conn, op(), &id).unwrap();

    transactions::set_tag_many(&mut conn, op(), vec![id.clone()], Some("tag_loss".to_string()))
        .unwrap();

    // Still soft-deleted, and get_transaction filters those out.
    assert!(transactions::get_transaction(&conn, &id).unwrap().is_none());
}

#[test]
fn set_account_many_moves_exactly_the_selected_ids() {
    let mut conn = fresh_db("set-account-many");
    let from = account(&mut conn, "From");
    let to = account(&mut conn, "To");

    let a = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&from, "A", 1_000, "2026-02-02"),
    )
    .unwrap();
    let keep = transactions::create_transaction(
        &mut conn,
        op(),
        expense(&from, "Keep", 1_000, "2026-02-03"),
    )
    .unwrap();

    transactions::set_account_many(&mut conn, op(), vec![a.clone()], to.clone()).unwrap();

    assert_eq!(
        transactions::get_transaction(&conn, &a).unwrap().unwrap().account_id,
        to
    );
    assert_eq!(
        transactions::get_transaction(&conn, &keep).unwrap().unwrap().account_id,
        from
    );
}

#[test]
fn the_bulk_commands_with_no_ids_are_no_ops() {
    let mut conn = fresh_db("bulk-empty");
    transactions::set_tag_many(&mut conn, op(), Vec::new(), Some("tag_loss".to_string())).unwrap();
    transactions::set_account_many(&mut conn, op(), Vec::new(), "acc_missing".to_string()).unwrap();
}
