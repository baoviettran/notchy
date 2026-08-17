//! Integration tests for the categories and budgets domain services.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{budgets, categories};
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
