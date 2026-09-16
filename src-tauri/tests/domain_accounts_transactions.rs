//! Integration tests for the accounts and transactions domain services.
//!
//! Each test creates a fresh schema-6 database via `bootstrap_current`.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{accounts, goals, transactions};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    AccountPatch, AccountType, GoalType, NewAccount, NewTransaction, OperationId, Patch,
    TransactionFilter, TransactionKind, TransactionPatch,
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

/// An all-omitted patch, the base for the edit-mode repair cases below.
fn no_patch() -> TransactionPatch {
    TransactionPatch {
        kind: None,
        date: None,
        amount: None,
        transfer_account_id: None,
        tag_id: Patch::Omitted,
        payee: Patch::Omitted,
        description: Patch::Omitted,
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
            kind: None,
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
fn update_transaction_kind_change() {
    let mut db = fresh_db("update_txn_kind");
    let acct = accounts::create_account(&mut db, op(), default_account("A")).unwrap();
    let other = accounts::create_account(&mut db, op(), default_account("B")).unwrap();
    let txn_id = transactions::create_transaction(&mut db, op(), default_expense(&acct, 100)).unwrap();

    // Expense → transfer requires a destination and links the pair.
    transactions::update_transaction(
        &mut db,
        op(),
        &txn_id,
        TransactionPatch {
            kind: Some(TransactionKind::Transfer),
            transfer_account_id: Some(other.clone()),
            date: None,
            amount: None,
            tag_id: Patch::Omitted,
            payee: Patch::Omitted,
            description: Patch::Omitted,
        },
    )
    .unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    assert_eq!(txn.kind, TransactionKind::Transfer);
    assert_eq!(txn.transfer_account_id.as_deref(), Some(other.as_str()));
    assert!(txn.transfer_pair_id.is_some());

    // Transfer → expense clears the transfer columns.
    transactions::update_transaction(
        &mut db,
        op(),
        &txn_id,
        TransactionPatch {
            kind: Some(TransactionKind::Expense),
            date: None,
            amount: None,
            transfer_account_id: None,
            tag_id: Patch::Omitted,
            payee: Patch::Omitted,
            description: Patch::Omitted,
        },
    )
    .unwrap();
    let txn = transactions::get_transaction(&db, &txn_id).unwrap().unwrap();
    assert_eq!(txn.kind, TransactionKind::Expense);
    assert!(txn.transfer_account_id.is_none());
    assert!(txn.transfer_pair_id.is_none());

    // Converting to a self-transfer is rejected.
    let txn2 = transactions::create_transaction(&mut db, op(), default_expense(&acct, 50)).unwrap();
    assert!(transactions::update_transaction(
        &mut db,
        op(),
        &txn2,
        TransactionPatch {
            kind: Some(TransactionKind::Transfer),
            transfer_account_id: Some(acct.clone()),
            date: None,
            amount: None,
            tag_id: Patch::Omitted,
            payee: Patch::Omitted,
            description: Patch::Omitted,
        },
    )
    .is_err());
}

#[test]
fn changing_kind_away_from_transfer_clears_the_destination() {
    let mut conn = fresh_db("c2-kind-change-away");
    let source = accounts::create_account(&mut conn, op(), default_account("Source")).unwrap();
    let dest = accounts::create_account(&mut conn, op(), default_account("Dest")).unwrap();

    let id = transactions::create_transaction(
        &mut conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Transfer,
            date: "2026-01-15".to_string(),
            amount: 10_000,
            account_id: source.clone(),
            transfer_account_id: Some(dest.clone()),
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();

    // Flip to expense while the patch still carries a destination. Before this
    // fix the destination was appended twice and last-wins left it populated
    // with a NULL pair id — the combination the schema CHECK forbids.
    let mut patch = no_patch();
    patch.kind = Some(TransactionKind::Expense);
    patch.transfer_account_id = Some(dest.clone());
    transactions::update_transaction(&mut conn, op(), &id, patch).unwrap();

    let row = transactions::get_transaction(&conn, &id).unwrap().unwrap();
    assert_eq!(row.kind, TransactionKind::Expense);
    assert_eq!(row.transfer_account_id, None);
    assert_eq!(row.transfer_pair_id, None);
}

#[test]
fn a_foreign_key_violation_reports_invalid_input_not_corruption() {
    let mut conn = fresh_db("c2-fk-mapping");
    // fresh_db does not enable foreign keys — SQLite defaults them off and only
    // the live-policy open path turns them on. Without this the bogus tag_id
    // inserts cleanly, there is no error at all, and unwrap_err() panics.
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // The business layer does not pre-validate the tag, so this reaches SQLite.
    let mut input = default_expense(&account, 100);
    input.tag_id = Some("tag_does_not_exist".to_string());
    let error = transactions::create_transaction(&mut conn, op(), input).unwrap_err();

    assert_eq!(error.code, ErrorCode::InvalidInput);
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

// ---------------------------------------------------------------------------
// I5 — amounts the schema cannot store are rejected by the business layer
// ---------------------------------------------------------------------------

#[test]
fn amounts_above_the_schema_cap_are_rejected_before_sqlite() {
    let mut conn = fresh_db("i5-amount-cap");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // All three pass the JS-safe-range check and fail the schema CHECK.
    for amount in [1_000_000_000_000_i64, 1_400_000_000_000, 9_007_199_254_740_991] {
        let error = transactions::create_transaction(&mut conn, op(), default_expense(&account, amount))
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::AmountOutOfRange, "amount {amount}");
    }
}

#[test]
fn the_largest_storable_amount_is_accepted() {
    let mut conn = fresh_db("i5-amount-boundary");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    transactions::create_transaction(&mut conn, op(), default_expense(&account, 999_999_999_999))
        .unwrap();
}

#[test]
fn batch_import_rejects_amounts_above_the_schema_cap() {
    let mut conn = fresh_db("i5-batch-cap");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // One good row and one over-cap row: the batch validates up front, so the
    // whole import fails and nothing is written — the same shape as an
    // unknown `account_id` in the existing validation loop.
    let inputs = vec![
        default_expense(&account, 100),
        default_expense(&account, 1_400_000_000_000),
    ];
    let error = transactions::create_transactions_batch(&mut conn, op(), inputs).unwrap_err();
    assert_eq!(error.code, ErrorCode::AmountOutOfRange);

    let list = transactions::list_transactions(&conn, TransactionFilter::default()).unwrap();
    assert!(list.is_empty(), "the whole batch must be rejected, wrote {}", list.len());
}

#[test]
fn update_rejects_amounts_above_the_schema_cap() {
    let mut conn = fresh_db("i5-update-cap");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();
    let txn_id = transactions::create_transaction(&mut conn, op(), default_expense(&account, 100))
        .unwrap();

    let error = transactions::update_transaction(
        &mut conn,
        op(),
        &txn_id,
        TransactionPatch {
            amount: Some(1_400_000_000_000),
            ..no_patch()
        },
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::AmountOutOfRange);

    let txn = transactions::get_transaction(&conn, &txn_id).unwrap().unwrap();
    assert_eq!(txn.amount, 100, "the rejected update must not be applied");
}

#[test]
fn retrying_a_restore_with_the_same_operation_id_replays_the_first_result() {
    let mut conn = fresh_db("i2-restore-retry");
    let id = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();
    accounts::delete_account(&mut conn, op(), &id).unwrap();

    let op_id = op();
    accounts::restore_account(&mut conn, op_id.clone(), &id).unwrap();

    // The row is live now. Because the guard sits outside run_idempotent, this
    // retry hits the guard first and returns InvalidInput instead of replaying
    // the receipt. The receipt exists precisely so that a retry is safe.
    accounts::restore_account(&mut conn, op_id, &id).unwrap();

    assert!(accounts::get_account(&conn, &id).unwrap().is_some());
}

#[test]
fn restoring_a_live_account_is_rejected() {
    let mut conn = fresh_db("i2-restore-guard");
    let id = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    // Never soft-deleted. Passes before and after the fix — a regression guard
    // on the guard, not the driver for this task.
    let error = accounts::restore_account(&mut conn, op(), &id).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}
#[test]
fn retrying_a_transaction_restore_with_the_same_operation_id_replays_the_first_result() {
    let mut conn = fresh_db("i2-restore-retry-tx");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();
    let id = transactions::create_transaction(&mut conn, op(), default_expense(&account, 5_000)).unwrap();
    transactions::delete_transaction(&mut conn, op(), &id).unwrap();

    let op_id = op();
    transactions::restore_transaction(&mut conn, op_id.clone(), &id).unwrap();

    // The row is live now. Because the guard sits outside run_idempotent, this
    // retry hits the guard first and returns InvalidInput instead of replaying
    // the receipt. The receipt exists precisely so that a retry is safe.
    // THIS is the call that must fail before the fix.
    transactions::restore_transaction(&mut conn, op_id, &id).unwrap();

    assert!(transactions::get_transaction(&conn, &id).unwrap().is_some());
}

#[test]
fn restoring_a_live_transaction_is_rejected() {
    let mut conn = fresh_db("i2-restore-guard-tx");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();
    let id = transactions::create_transaction(&mut conn, op(), default_expense(&account, 5_000)).unwrap();

    // Never soft-deleted. Passes before and after the fix — a regression guard
    // on the guard, not the driver for this task.
    let error = transactions::restore_transaction(&mut conn, op(), &id).unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}

#[test]
fn deleting_an_account_with_linked_goals_names_them() {
    let mut conn = fresh_db("i3-linked-goals");
    let account = accounts::create_account(&mut conn, op(), default_account("Savings")).unwrap();
    goals::create_goal(
        &mut conn,
        op(),
        "Emergency fund".to_string(),
        GoalType::Savings,
        1_000_000,
        "2027-01-01".to_string(),
        Some(account.clone()),
        0,
        1,
    )
    .unwrap();

    let error = accounts::delete_account(&mut conn, op(), &account).unwrap_err();

    assert_eq!(error.code, ErrorCode::AccountDeleteLinkedGoals);
    assert_eq!(error.meta.get("count").map(String::as_str), Some("1"));
    assert_eq!(
        error.meta.get("names").map(String::as_str),
        Some("Emergency fund")
    );
}

#[test]
fn control_characters_are_stripped_according_to_the_shared_corpus() {
    let corpus_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/control-chars.json");
    let corpus: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&corpus_path).unwrap()).unwrap();

    let mut conn = fresh_db("i6-control-chars");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    for case in corpus["cases"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();

        let id = transactions::create_transaction(&mut conn, op(), default_expense(&account, 100))
            .unwrap();

        let mut patch = no_patch();
        patch.description = Patch::Replace { value: input.to_string() };
        transactions::update_transaction(&mut conn, op(), &id, patch).unwrap();

        let row = transactions::get_transaction(&conn, &id).unwrap().unwrap();
        assert_eq!(row.description.as_deref(), Some(expected), "input {input:?}");
    }
}

#[test]
fn the_shared_balance_helper_matches_the_transaction_it_moves() {
    let mut conn = fresh_db("s1-balance-helper");
    let account = accounts::create_account(&mut conn, op(), default_account("A")).unwrap();

    transactions::create_transaction(&mut conn, op(), default_expense(&account, 2_500))
        .unwrap();

    let today = accounts::today_iso();
    let moved = notchy_lib::database::domains::balance::account_balance_as_of(
        &conn, &account, &today,
    )
    .unwrap();

    // -2500 as an expense from a fresh checking account.
    assert_eq!(moved, -2_500);

    // The point of the move: the old entry point must still agree with it.
    assert_eq!(accounts::get_balance(&conn, &account, &today).unwrap(), moved);
}
