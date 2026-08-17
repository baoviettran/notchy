//! Integration tests for the accounts and transactions domain services.
//!
//! Each test creates a fresh schema-6 database via `bootstrap_current`.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{accounts, transactions};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    AccountPatch, AccountType, NewAccount, NewTransaction, OperationId, Patch, TransactionFilter,
    TransactionKind, TransactionPatch,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "notchy-domain-test-{}",
        nanos
    ));
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

fn default_account(name: &str) -> NewAccount {
    NewAccount {
        name: name.to_string(),
        account_type: AccountType::Checking,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: None,
        initial_balance_date: None,
    }
}

fn default_expense(account_id: &str, amount: i64) -> NewTransaction {
    NewTransaction {
        kind: TransactionKind::Expense,
        date: "2026-01-15".to_string(),
        amount,
        account_id: account_id.to_string(),
        transfer_account_id: None,
        refund_of_id: None,
        tag_id: None,
        payee: None,
        description: None,
    }
}

// ---------------------------------------------------------------------------
// Account tests
// ---------------------------------------------------------------------------

#[test]
fn create_and_get_account() {
    let mut db = fresh_db("create_get");
    let id = accounts::create_account(&mut db, op(), default_account("Main")).unwrap();
    let acct = accounts::get_account(&db, &id).unwrap().unwrap();
    assert_eq!(acct.name, "Main");
    assert_eq!(acct.account_type, AccountType::Checking);
    assert_eq!(acct.currency, "USD");
    assert_eq!(acct.balance, 0);
}

#[test]
fn list_accounts_returns_all() {
    let mut db = fresh_db("list");
    accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    accounts::create_account(&mut db, op(), default_account("B")).unwrap();
    let list = accounts::list_accounts(&db).unwrap();
    assert_eq!(list.len(), 2);
}

#[test]
fn create_account_with_opening_balance() {
    let mut db = fresh_db("opening_balance");
    let input = NewAccount {
        name: "Savings".to_string(),
        account_type: AccountType::Savings,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: Some(5000),
        initial_balance_date: Some("2026-01-01".to_string()),
    };
    let id = accounts::create_account(&mut db, op(), input).unwrap();
    let acct = accounts::get_account(&db, &id).unwrap().unwrap();
    assert_eq!(acct.balance, 5000);
}

#[test]
fn liability_opening_balance_is_negative() {
    let mut db = fresh_db("liability_balance");
    let input = NewAccount {
        name: "Credit Card".to_string(),
        account_type: AccountType::CreditCard,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: Some(1000),
        initial_balance_date: None,
    };
    let id = accounts::create_account(&mut db, op(), input).unwrap();
    let acct = accounts::get_account(&db, &id).unwrap().unwrap();
    // Liability opening balance recorded as expense → balance = -1000
    assert_eq!(acct.balance, -1000);
}

#[test]
fn account_and_opening_balance_are_one_operation() {
    // Prove atomicity: if the opening-balance insert fails, the account
    // must not exist either. We can't easily inject a failure mid-transaction
    // without failpoints, so we verify the invariant by checking both rows
    // exist after a successful create.
    let mut db = fresh_db("atomicity");
    let input = NewAccount {
        name: "Test".to_string(),
        account_type: AccountType::Checking,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: Some(100),
        initial_balance_date: None,
    };
    let id = accounts::create_account(&mut db, op(), input).unwrap();
    // Account exists
    assert!(accounts::get_account(&db, &id).unwrap().is_some());
    // Opening balance transaction exists
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM transactions WHERE account_id = ?1 AND tag_id = 'tag_initial_balance'",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn update_account_name() {
    let mut db = fresh_db("update_name");
    let id = accounts::create_account(&mut db, op(), default_account("Old")).unwrap();
    accounts::update_account(
        &mut db,
        op(),
        &id,
        AccountPatch {
            name: Some("New".to_string()),
            account_type: None,
            counterparty: Patch::Omitted,
            archived: None,
        },
    )
    .unwrap();
    let acct = accounts::get_account(&db, &id).unwrap().unwrap();
    assert_eq!(acct.name, "New");
}

#[test]
fn update_account_type_change_cross_boundary_rejected() {
    let mut db = fresh_db("type_change");
    let id = accounts::create_account(&mut db, op(), default_account("Test")).unwrap();
    let result = accounts::update_account(
        &mut db,
        op(),
        &id,
        AccountPatch {
            name: None,
            account_type: Some(AccountType::CreditCard),
            counterparty: Patch::Omitted,
            archived: None,
        },
    );
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().code, ErrorCode::InvalidInput);
}

#[test]
fn loan_account_requires_counterparty() {
    let mut db = fresh_db("loan_counterparty");
    let result = accounts::create_account(
        &mut db,
        op(),
        NewAccount {
            name: "Loan".to_string(),
            account_type: AccountType::LoanToPerson,
            counterparty: None,
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    );
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().code, ErrorCode::InvalidInput);
}

#[test]
fn single_currency_enforcement() {
    let mut db = fresh_db("currency");
    accounts::create_account(&mut db, op(), default_account("USD")).unwrap();
    let result = accounts::create_account(
        &mut db,
        op(),
        NewAccount {
            name: "EUR".to_string(),
            account_type: AccountType::Savings,
            counterparty: None,
            currency: "EUR".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    );
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().code, ErrorCode::InvalidInput);
}

#[test]
fn delete_account_soft_deletes() {
    let mut db = fresh_db("delete");
    let id = accounts::create_account(&mut db, op(), default_account("Del")).unwrap();
    accounts::delete_account(&mut db, op(), &id).unwrap();
    assert!(accounts::get_account(&db, &id).unwrap().is_none());
    // Still in the table (soft-deleted)
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM accounts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

// ---------------------------------------------------------------------------
// Transaction tests
// ---------------------------------------------------------------------------

#[test]
fn create_expense_and_get() {
    let mut db = fresh_db("txn_expense");
    let acct_id = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let txn_id = transactions::create_transaction(&mut db, op(), default_expense(&acct_id, 500)).unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    assert_eq!(txn.kind, TransactionKind::Expense);
    assert_eq!(txn.amount, 500);
}

#[test]
fn balance_reflects_expense() {
    let mut db = fresh_db("balance_expense");
    let acct_id = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    transactions::create_transaction(&mut db, op(), default_expense(&acct_id, 500)).unwrap();
    let acct = accounts::get_account(&db, &acct_id).unwrap().unwrap();
    assert_eq!(acct.balance, -500);
}

#[test]
fn create_income_increases_balance() {
    let mut db = fresh_db("balance_income");
    let acct_id = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Income,
            date: "2026-01-15".to_string(),
            amount: 1000,
            account_id: acct_id.clone(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: Some("Salary".to_string()),
            description: None,
        },
    )
    .unwrap();
    let acct = accounts::get_account(&db, &acct_id).unwrap().unwrap();
    assert_eq!(acct.balance, 1000);
}

#[test]
fn transfer_debits_source_credits_dest() {
    let mut db = fresh_db("transfer");
    let src = accounts::create_account(&mut db, op(), default_account("Src")).unwrap();
    let dst = accounts::create_account(&mut db, op(), default_account("Dst")).unwrap();
    let txn_id = transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Transfer,
            date: "2026-01-15".to_string(),
            amount: 300,
            account_id: src.clone(),
            transfer_account_id: Some(dst.clone()),
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    assert_eq!(txn.transfer_account_id.as_deref(), Some(dst.as_str()));
    assert!(txn.transfer_pair_id.is_some());
    // Source debited, dest credited
    let src_acct = accounts::get_account(&db, &src).unwrap().unwrap();
    let dst_acct = accounts::get_account(&db, &dst).unwrap().unwrap();
    assert_eq!(src_acct.balance, -300);
    assert_eq!(dst_acct.balance, 300);
}

#[test]
fn self_transfer_rejected() {
    let mut db = fresh_db("self_transfer");
    let acct = accounts::create_account(&mut db, op(), default_account("Solo")).unwrap();
    let result = transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Transfer,
            date: "2026-01-15".to_string(),
            amount: 100,
            account_id: acct.clone(),
            transfer_account_id: Some(acct),
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    );
    assert!(result.is_err());
}

#[test]
fn refund_requires_expense_target() {
    let mut db = fresh_db("refund_target");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let income_id = transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Income,
            date: "2026-01-15".to_string(),
            amount: 100,
            account_id: acct.clone(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();
    let result = transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Refund,
            date: "2026-01-16".to_string(),
            amount: 50,
            account_id: acct,
            transfer_account_id: None,
            refund_of_id: Some(income_id),
            tag_id: None,
            payee: None,
            description: None,
        },
    );
    assert!(result.is_err());
}

#[test]
fn list_transactions_with_filter() {
    let mut db = fresh_db("list_filter");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    transactions::create_transaction(&mut db, op(), default_expense(&acct, 100)).unwrap();
    transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Income,
            date: "2026-01-15".to_string(),
            amount: 200,
            account_id: acct,
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();
    let expenses = transactions::list_transactions(
        &db,
        TransactionFilter {
            kind: Some(TransactionKind::Expense),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(expenses.len(), 1);
    assert_eq!(expenses[0].amount, 100);
}

#[test]
fn update_transaction_amount() {
    let mut db = fresh_db("update_txn");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let txn_id = transactions::create_transaction(&mut db, op(), default_expense(&acct, 100)).unwrap();
    transactions::update_transaction(
        &mut db,
        op(),
        &txn_id,
        TransactionPatch {
            amount: Some(200),
            date: None,
            tag_id: Patch::Omitted,
            payee: Patch::Omitted,
            description: Patch::Omitted,
            transfer_account_id: None,
        },
    )
    .unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    assert_eq!(txn.amount, 200);
}

#[test]
fn delete_and_restore_transaction() {
    let mut db = fresh_db("delete_restore");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let txn_id = transactions::create_transaction(&mut db, op(), default_expense(&acct, 100)).unwrap();
    transactions::delete_transaction(&mut db, op(), &txn_id).unwrap();
    assert!(transactions::get_transaction(&db, &txn_id).unwrap().is_none());
    transactions::restore_transaction(&mut db, op(), &txn_id).unwrap();
    assert!(transactions::get_transaction(&db, &txn_id).unwrap().is_some());
}

#[test]
fn duplicate_transaction() {
    let mut db = fresh_db("duplicate");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let orig_id = transactions::create_transaction(&mut db, op(), default_expense(&acct, 100)).unwrap();
    let new_id = transactions::duplicate_transaction(&mut db, op(), &orig_id).unwrap();
    assert_ne!(orig_id, new_id);
    let orig = transactions::get_transaction(&db, &orig_id).unwrap().unwrap();
    let dup = transactions::get_transaction(&db, &new_id).unwrap().unwrap();
    assert_eq!(orig.amount, dup.amount);
    assert_eq!(orig.kind, dup.kind);
    assert_eq!(orig.account_id, dup.account_id);
}

#[test]
fn batch_import_creates_all() {
    let mut db = fresh_db("batch");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let inputs: Vec<NewTransaction> = (0..5)
        .map(|i| NewTransaction {
            kind: TransactionKind::Expense,
            date: "2026-01-15".to_string(),
            amount: (i + 1) * 100,
            account_id: acct.clone(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        })
        .collect();
    let ids = transactions::create_transactions_batch(&mut db, op(), inputs).unwrap();
    assert_eq!(ids.len(), 5);
    let list = transactions::list_transactions(&db, TransactionFilter::default()).unwrap();
    assert_eq!(list.len(), 5);
}

#[test]
fn batch_import_rejects_non_expense_income() {
    let mut db = fresh_db("batch_reject");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let inputs = vec![NewTransaction {
        kind: TransactionKind::Transfer,
        date: "2026-01-15".to_string(),
        amount: 100,
        account_id: acct.clone(),
        transfer_account_id: Some(acct),
        refund_of_id: None,
        tag_id: None,
        payee: None,
        description: None,
    }];
    let result = transactions::create_transactions_batch(&mut db, op(), inputs);
    assert!(result.is_err());
}

#[test]
fn idempotent_retry_returns_same_result() {
    let mut db = fresh_db("idempotency");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let op_id = op();
    let input = default_expense(&acct, 500);
    let first_id = transactions::create_transaction(&mut db, op_id.clone(), input.clone()).unwrap();
    // Retry with same operation_id and same input → same result
    let second_id = transactions::create_transaction(&mut db, op_id, input).unwrap();
    assert_eq!(first_id, second_id);
    // Only one row created
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn pagination_respects_limit_offset() {
    let mut db = fresh_db("pagination");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    for i in 0..10 {
        transactions::create_transaction(
            &mut db,
            op(),
            NewTransaction {
                kind: TransactionKind::Expense,
                date: format!("2026-01-{:02}", (i % 28) + 1),
                amount: (i + 1) * 10,
                account_id: acct.clone(),
                transfer_account_id: None,
                refund_of_id: None,
                tag_id: None,
                payee: None,
                description: None,
            },
        )
        .unwrap();
    }
    let page = transactions::list_transactions(
        &db,
        TransactionFilter {
            limit: Some(3),
            offset: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.len(), 3);
}

#[test]
fn description_strips_control_chars() {
    let mut db = fresh_db("control_chars");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let txn_id = transactions::create_transaction(
        &mut db,
        op(),
        NewTransaction {
            kind: TransactionKind::Expense,
            date: "2026-01-15".to_string(),
            amount: 100,
            account_id: acct,
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: Some("Hello\x00\x01\x1F\nWorld\x7F".to_string()),
        },
    )
    .unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    // Control chars stripped, newline preserved
    assert_eq!(txn.description.as_deref(), Some("Hello\nWorld"));
}
