//! Integration tests for the categories and budgets domain services.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{budgets, categories};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::OperationId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tid = std::thread::current().id();
    let dir = std::env::temp_dir().join(format!(
        "notchy-catbud-{}-{:?}-{}",
        tag, tid, nanos
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("db.sqlite")
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn op() -> OperationId {
    OperationId::generate()
}

/// Create a test bucket and return its ID.
fn create_test_bucket(conn: &mut Connection, name: &str) -> String {
    categories::create_bucket(conn, op(), name.to_string(), 1).unwrap()
}

/// Create a test tag within a bucket and return its ID.
fn create_test_tag(conn: &mut Connection, name: &str, bucket_id: &str) -> String {
    categories::create_tag(conn, op(), name.to_string(), bucket_id.to_string()).unwrap()
}

// ---------------------------------------------------------------------------
// Bucket tests
// ---------------------------------------------------------------------------

#[test]
fn create_and_list_buckets() {
    let mut db = fresh_db("buckets_list");
    let before = categories::list_buckets(&db).unwrap().len();
    let id = categories::create_bucket(&mut db, op(), "Food".to_string(), 1).unwrap();
    let buckets = categories::list_buckets(&db).unwrap();
    assert_eq!(buckets.len(), before + 1);
    let created = buckets.iter().find(|b| b.id == id).unwrap();
    assert_eq!(created.name, "Food");
    assert_eq!(created.budgetable, 1);
}

#[test]
fn rename_bucket() {
    let mut db = fresh_db("bucket_rename");
    let id = create_test_bucket(&mut db, "Old");
    categories::rename_bucket(&mut db, op(), &id, "New".to_string()).unwrap();
    let buckets = categories::list_buckets(&db).unwrap();
    let renamed = buckets.iter().find(|b| b.id == id).unwrap();
    assert_eq!(renamed.name, "New");
}

#[test]
fn set_rollover_enabled() {
    let mut db = fresh_db("rollover");
    let id = create_test_bucket(&mut db, "Bucket");
    categories::set_rollover_enabled(&mut db, op(), &id, false).unwrap();
    let buckets = categories::list_buckets(&db).unwrap();
    let target = buckets.iter().find(|b| b.id == id).unwrap();
    assert_eq!(target.rollover_enabled, 0);
}

#[test]
fn delete_bucket_no_tags() {
    let mut db = fresh_db("bucket_delete");
    let before = categories::list_buckets(&db).unwrap().len();
    let id = create_test_bucket(&mut db, "Del");
    categories::delete_bucket(&mut db, op(), &id).unwrap();
    let buckets = categories::list_buckets(&db).unwrap();
    assert_eq!(buckets.len(), before);
    assert!(buckets.iter().all(|b| b.id != id));
}

#[test]
fn delete_bucket_with_tags_rejected() {
    let mut db = fresh_db("bucket_delete_tags");
    let bucket_id = create_test_bucket(&mut db, "Bucket");
    create_test_tag(&mut db, "Tag", &bucket_id);
    let result = categories::delete_bucket(&mut db, op(), &bucket_id);
    assert!(result.is_err());
}

#[test]
fn sort_order_auto_increments() {
    let mut db = fresh_db("sort_order");
    let _a = create_test_bucket(&mut db, "A");
    let _b = create_test_bucket(&mut db, "B");
    let buckets = categories::list_buckets(&db).unwrap();
    assert_eq!(buckets[0].sort_order, 0);
    assert_eq!(buckets[1].sort_order, 1);
}

// ---------------------------------------------------------------------------
// Tag tests
// ---------------------------------------------------------------------------

#[test]
fn create_and_list_tags() {
    let mut db = fresh_db("tags_list");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag_id = create_test_tag(&mut db, "Groceries", &bucket);
    let tags = categories::list_tags(&db, Some(&bucket)).unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].id, tag_id);
    assert_eq!(tags[0].name, "Groceries");
    assert_eq!(tags[0].type_id, bucket);
}

#[test]
fn list_tags_all() {
    let mut db = fresh_db("tags_all");
    let before = categories::list_tags(&db, None).unwrap().len();
    let b1 = create_test_bucket(&mut db, "A");
    let b2 = create_test_bucket(&mut db, "B");
    create_test_tag(&mut db, "T1", &b1);
    create_test_tag(&mut db, "T2", &b2);
    let all = categories::list_tags(&db, None).unwrap();
    assert_eq!(all.len(), before + 2);
}

#[test]
fn rename_tag() {
    let mut db = fresh_db("tag_rename");
    let bucket = create_test_bucket(&mut db, "B");
    let id = create_test_tag(&mut db, "Old", &bucket);
    categories::rename_tag(&mut db, op(), &id, "New".to_string()).unwrap();
    let tags = categories::list_tags(&db, Some(&bucket)).unwrap();
    assert_eq!(tags[0].name, "New");
}

#[test]
fn tag_sort_order_scoped_to_bucket() {
    let mut db = fresh_db("tag_sort");
    let bucket = create_test_bucket(&mut db, "B");
    create_test_tag(&mut db, "A", &bucket);
    create_test_tag(&mut db, "C", &bucket);
    let tags = categories::list_tags(&db, Some(&bucket)).unwrap();
    assert_eq!(tags[0].sort_order, 0);
    assert_eq!(tags[1].sort_order, 1);
}

#[test]
fn move_tag_to_different_bucket() {
    let mut db = fresh_db("tag_move");
    let b1 = create_test_bucket(&mut db, "A");
    let b2 = create_test_bucket(&mut db, "B");
    let tag_id = create_test_tag(&mut db, "T", &b1);
    let info = categories::move_tag(&mut db, op(), &tag_id, b2.clone()).unwrap();
    assert_eq!(info.affected_count, 0);
    let tags_b1 = categories::list_tags(&db, Some(&b1)).unwrap();
    let tags_b2 = categories::list_tags(&db, Some(&b2)).unwrap();
    assert!(tags_b1.is_empty());
    assert_eq!(tags_b2.len(), 1);
}

#[test]
fn delete_tag_uncategorise() {
    let mut db = fresh_db("tag_uncat");
    let bucket = create_test_bucket(&mut db, "B");
    let tag_id = create_test_tag(&mut db, "T", &bucket);
    categories::delete_tag(&mut db, op(), &tag_id, "uncategorise").unwrap();
    let tags = categories::list_tags(&db, Some(&bucket)).unwrap();
    assert!(tags.is_empty());
}

#[test]
fn delete_tag_merge_repoints_transactions() {
    let mut db = fresh_db("tag_merge");
    let bucket = create_test_bucket(&mut db, "B");
    let source = create_test_tag(&mut db, "Source", &bucket);
    let target = create_test_tag(&mut db, "Target", &bucket);

    // Create an account and a transaction with the source tag.
    let acct_id = {
        use notchy_lib::database::domains::accounts;
        accounts::create_account(
            &mut db,
            op(),
            notchy_lib::database::types::NewAccount {
                name: "A".to_string(),
                account_type: notchy_lib::database::types::AccountType::Checking,
                counterparty: None,
                currency: "USD".to_string(),
                initial_balance: None,
                initial_balance_date: None,
            },
        )
        .unwrap()
    };

    let txn_id = {
        use notchy_lib::database::domains::transactions;
        transactions::create_transaction(
            &mut db,
            op(),
            notchy_lib::database::types::NewTransaction {
                kind: notchy_lib::database::types::TransactionKind::Expense,
                date: "2026-01-15".to_string(),
                amount: 100,
                account_id: acct_id,
                transfer_account_id: None,
                refund_of_id: None,
                tag_id: Some(source.clone()),
                payee: None,
                description: None,
            },
        )
        .unwrap()
    };

    // Merge source into target.
    categories::delete_tag(&mut db, op(), &source, &target).unwrap();

    // Transaction now points to target.
    let txn = notchy_lib::database::domains::transactions::get_transaction(&db, &txn_id)
        .unwrap()
        .unwrap();
    assert_eq!(txn.tag_id.as_deref(), Some(target.as_str()));

    // Source tag is soft-deleted.
    let source_tags = categories::list_tags(&db, Some(&bucket)).unwrap();
    assert_eq!(source_tags.len(), 1);
    assert_eq!(source_tags[0].id, target);
}

// ---------------------------------------------------------------------------
// Budget tests
// ---------------------------------------------------------------------------

#[test]
fn set_and_get_allocation() {
    let mut db = fresh_db("budget_alloc");
    let bucket = create_test_bucket(&mut db, "Food");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 50000).unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].allocated, 50000);
    assert_eq!(summaries[0].spent, 0);
    assert_eq!(summaries[0].remaining, 50000);
}

#[test]
fn allocation_upsert_is_idempotent() {
    let mut db = fresh_db("budget_upsert");
    let bucket = create_test_bucket(&mut db, "Food");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 50000).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 60000).unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].allocated, 60000);
}

#[test]
fn has_allocations() {
    let mut db = fresh_db("has_alloc");
    assert!(!budgets::has_allocations(&db, "2026-08").unwrap());
    let bucket = create_test_bucket(&mut db, "Food");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 100).unwrap();
    assert!(budgets::has_allocations(&db, "2026-08").unwrap());
}

#[test]
fn copy_previous_month_copies_allocations() {
    let mut db = fresh_db("copy_prev");
    let bucket = create_test_bucket(&mut db, "Food");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-07", 30000).unwrap();
    budgets::copy_from_previous_month(&mut db, op(), "2026-08").unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].allocated, 30000);
}

#[test]
fn copy_previous_month_is_idempotent() {
    let mut db = fresh_db("copy_idem");
    let bucket = create_test_bucket(&mut db, "Food");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-07", 30000).unwrap();
    let op1 = op();
    budgets::copy_from_previous_month(&mut db, op1.clone(), "2026-08").unwrap();
    let op2 = op();
    budgets::copy_from_previous_month(&mut db, op2, "2026-08").unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].allocated, 30000);
}

#[test]
fn spent_deducts_from_remaining() {
    let mut db = fresh_db("budget_spent");
    let bucket = create_test_bucket(&mut db, "Food");

    // Create account + expense tagged to this bucket.
    let acct_id = {
        use notchy_lib::database::domains::accounts;
        accounts::create_account(
            &mut db,
            op(),
            notchy_lib::database::types::NewAccount {
                name: "A".to_string(),
                account_type: notchy_lib::database::types::AccountType::Checking,
                counterparty: None,
                currency: "USD".to_string(),
                initial_balance: None,
                initial_balance_date: None,
            },
        )
        .unwrap()
    };

    let tag_id = create_test_tag(&mut db, "T", &bucket);

    {
        use notchy_lib::database::domains::transactions;
        transactions::create_transaction(
            &mut db,
            op(),
            notchy_lib::database::types::NewTransaction {
                kind: notchy_lib::database::types::TransactionKind::Expense,
                date: "2026-08-15".to_string(),
                amount: 200,
                account_id: acct_id,
                transfer_account_id: None,
                refund_of_id: None,
                tag_id: Some(tag_id),
                payee: None,
                description: None,
            },
        )
        .unwrap();
    }

    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 500).unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries[0].spent, 200);
    assert_eq!(summaries[0].remaining, 300);
}

#[test]
fn rollover_captures_prior_surplus() {
    let mut db = fresh_db("budget_rollover");
    let bucket = create_test_bucket(&mut db, "Food");
    // Rollover is enabled by default (1).

    // July budget: allocated 1000, spent 400 → surplus 600.
    budgets::set_allocation(&mut db, op(), &bucket, "2026-07", 1000).unwrap();
    let tag_id = create_test_tag(&mut db, "T", &bucket);
    let acct_id = {
        use notchy_lib::database::domains::accounts;
        accounts::create_account(
            &mut db,
            op(),
            notchy_lib::database::types::NewAccount {
                name: "A".to_string(),
                account_type: notchy_lib::database::types::AccountType::Checking,
                counterparty: None,
                currency: "USD".to_string(),
                initial_balance: None,
                initial_balance_date: None,
            },
        )
        .unwrap()
    };
    {
        use notchy_lib::database::domains::transactions;
        transactions::create_transaction(
            &mut db,
            op(),
            notchy_lib::database::types::NewTransaction {
                kind: notchy_lib::database::types::TransactionKind::Expense,
                date: "2026-07-15".to_string(),
                amount: 400,
                account_id: acct_id,
                transfer_account_id: None,
                refund_of_id: None,
                tag_id: Some(tag_id),
                payee: None,
                description: None,
            },
        )
        .unwrap();
    }

    // August budget.
    budgets::set_allocation(&mut db, op(), &bucket, "2026-08", 2000).unwrap();
    let summaries = budgets::get_budgets_for_month(&db, "2026-08").unwrap();
    assert_eq!(summaries[0].allocated, 2000);
    assert_eq!(summaries[0].rolled_over, 600);
    assert_eq!(summaries[0].available, 2600);
}

#[test]
fn a_malformed_month_is_invalid_input() {
    let conn = fresh_db("i4-bad-month");

    for month in ["2026-13", "2026-00", "2026", "2026-1", "not-a-month", ""] {
        let error = budgets::get_budgets_for_month(&conn, month).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput, "month {month:?}");
    }
}

// ---------------------------------------------------------------------------
// Rollover pool fixtures
// ---------------------------------------------------------------------------

/// A checking account for seeding transactions against.
fn fresh_account(conn: &mut Connection) -> String {
    use notchy_lib::database::domains::accounts;
    accounts::create_account(
        conn,
        op(),
        notchy_lib::database::types::NewAccount {
            name: "A".to_string(),
            account_type: notchy_lib::database::types::AccountType::Checking,
            counterparty: None,
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    )
    .unwrap()
}

/// Seed an expense tagged into a bucket.
fn seed_expense(conn: &mut Connection, account_id: &str, tag_id: &str, amount: i64, date: &str) {
    use notchy_lib::database::domains::transactions;
    use notchy_lib::database::types::{NewTransaction, TransactionKind};
    transactions::create_transaction(
        conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Expense,
            date: date.to_string(),
            amount,
            account_id: account_id.to_string(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: Some(tag_id.to_string()),
            payee: None,
            description: None,
        },
    )
    .unwrap();
}

/// Seed an income transaction (kind = 'income', no tag).
fn seed_income(conn: &mut Connection, account_id: &str, amount: i64, date: &str) {
    use notchy_lib::database::domains::transactions;
    use notchy_lib::database::types::{NewTransaction, TransactionKind};
    transactions::create_transaction(
        conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Income,
            date: date.to_string(),
            amount,
            account_id: account_id.to_string(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();
}

/// Baseline (today's) carry rule, before the running floor lands: a rollover
/// bucket carries the full cumulative `allocated - spent` of every prior
/// budgeted month, negatives included. The counterexample fixture
/// (M1 = 2026-01, M2 = 2026-02, M3 = 2026-03):
///
///   |     | income | allocated | spent | carry | available | lmo | toBudget | Σ   |
///   |-----|--------|-----------|-------|-------|-----------|-----|----------|-----|
///   | M1  | 100    | 100       | 0     | 0     | 100       | 0   | 0        | 100 |
///   | M2  | 150    | 0         | 150   | 100   | -50       | 0   | 150      | 100 |
///   | M3  | 0      | 0         | 0     | 0 / 100 | 0 / 100 | -50 | 100      | 100 |
///
/// (M3's carry is `0` under the running floor and `100` under the wrong
/// per-month sum; this test pins the pre-change full-carry reading, which
/// Task 2 then inverts.)
#[test]
fn baseline_full_carry_over_budgeted_months() {
    let mut db = fresh_db("pool_baseline");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    let account = fresh_account(&mut db);
    seed_expense(&mut db, &account, &tag, 150, "2026-02-10");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-03", 0).unwrap();

    // Today: full cumulative carry, negative included.
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-02").unwrap(), 100);
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), -50);
}

/// A rollover-OFF bucket's carry is a running floor in chronological month
/// order: `C_m = max(0, C_{m-1} + L_{m-1})`, `L_m = allocated_m - spent_m`.
/// Same counterexample fixture as the browser test, same numbers:
///
///   |     | income | allocated | spent | carry | available | lmo | toBudget | Σ   |
///   |-----|--------|-----------|-------|-------|-----------|-----|----------|-----|
///   | M1  | 100    | 100       | 0     | 0     | 100       | 0   | 0        | 100 |
///   | M2  | 150    | 0         | 150   | 100   | -50       | 0   | 150      | 100 |
///   | M3  | 0      | 0         | 0     | 0     | 0         | -50 | 100      | 100 |
///
/// A per-month sum would carry 100 into M3 and report Σ = 200 — it creates
/// money. The floor makes Σ = 100 in every month.
#[test]
fn rollover_off_carry_is_a_running_floor() {
    let mut db = fresh_db("pool_floor");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    let account = fresh_account(&mut db);
    seed_expense(&mut db, &account, &tag, 150, "2026-02-10");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-03", 0).unwrap();

    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-01").unwrap(), 0);
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-02").unwrap(), 100);
    // Floor: max(0, max(0, 0 + 100) - 150) = 0, not the per-month sum -50.
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), 0);
}

/// Rollover ON keeps the full carry, negative included.
#[test]
fn rollover_on_carry_keeps_the_negative() {
    let mut db = fresh_db("pool_on");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    let account = fresh_account(&mut db);
    seed_expense(&mut db, &account, &tag, 150, "2026-02-10");

    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), -50);
}

/// The gate is gone: `available` has one formula for every bucket.
#[test]
fn get_budgets_for_month_drops_the_enabled_gate() {
    let mut db = fresh_db("pool_gate");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 100).unwrap();
    let account = fresh_account(&mut db);
    seed_expense(&mut db, &account, &tag, 60, "2026-02-10");

    let summaries = budgets::get_budgets_for_month(&db, "2026-02").unwrap();
    let s = summaries.iter().find(|s| s.type_id == bucket).unwrap();
    // rolled_over carries the rollover-OFF floor (100 - 0 = 100), and
    // available = allocated + rolled_over - spent.
    assert_eq!(s.rolled_over, 100);
    assert_eq!(s.available, 140);
}
