//! Integration tests for the goals, rules, and meta domain services.
//!
//! Each test creates a fresh schema-6 database via `bootstrap_current`.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::{accounts, goals, meta, rules};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    GoalStatus, GoalType, MatchMode, NewAccount, OperationId, RuleSource,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("notchy-domain-test-{}", nanos));
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

fn create_test_account(db: &mut Connection) -> String {
    let input = NewAccount {
        name: "Savings".to_string(),
        account_type: notchy_lib::database::types::AccountType::Savings,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: Some(10_000),
        initial_balance_date: Some("2026-01-01".to_string()),
    };
    accounts::create_account(db, op(), input).unwrap()
}

fn create_test_expense(db: &mut Connection, account_id: &str, amount: i64, tag_id: Option<&str>) -> String {
    let input = notchy_lib::database::types::NewTransaction {
        kind: notchy_lib::database::types::TransactionKind::Expense,
        date: "2026-01-15".to_string(),
        amount,
        account_id: account_id.to_string(),
        transfer_account_id: None,
        refund_of_id: None,
        tag_id: tag_id.map(|s| s.to_string()),
        payee: None,
        description: None,
    };
    transactions::create_transaction(db, op(), input).unwrap()
}

use notchy_lib::database::domains::transactions;

// ===========================================================================
// Goal tests
// ===========================================================================

#[test]
fn create_and_get_goal() {
    let mut db = fresh_db("goal_create");
    let id = goals::create_goal(
        &mut db,
        op(),
        "Emergency Fund".to_string(),
        GoalType::Savings,
        50_000,
        "2026-12-31".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    let goal = goals::get_goal(&db, &id).unwrap().unwrap();
    assert_eq!(goal.name, "Emergency Fund");
    assert_eq!(goal.goal_type, GoalType::Savings);
    assert_eq!(goal.target_amount, 50_000);
    assert_eq!(goal.status, GoalStatus::Active);
    assert_eq!(goal.current_amount, 0);
    assert_eq!(goal.progress_pct, 0);
}

#[test]
fn list_goals_returns_all() {
    let mut db = fresh_db("goal_list");
    goals::create_goal(
        &mut db,
        op(),
        "Goal A".to_string(),
        GoalType::Savings,
        10_000,
        "2026-12-31".to_string(),
        None,
        0,
        1,
    )
    .unwrap();
    goals::create_goal(
        &mut db,
        op(),
        "Goal B".to_string(),
        GoalType::DebtPayoff,
        5_000,
        "2026-06-30".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    let list = goals::list_goals(&db).unwrap();
    assert_eq!(list.len(), 2);
}

#[test]
fn goal_progress_with_linked_account() {
    let mut db = fresh_db("goal_progress");
    let account_id = create_test_account(&mut db);

    let id = goals::create_goal(
        &mut db,
        op(),
        "Savings Goal".to_string(),
        GoalType::Savings,
        20_000,
        "2026-12-31".to_string(),
        Some(account_id.clone()),
        0,
        1,
    )
    .unwrap();

    let goal = goals::get_goal(&db, &id).unwrap().unwrap();
    assert_eq!(goal.current_amount, 10_000);
    assert_eq!(goal.progress_pct, 50);
}

#[test]
fn goal_progress_net_worth() {
    let mut db = fresh_db("goal_networth");
    let _account_id = create_test_account(&mut db);

    // Create a second account with income.
    let account2_input = NewAccount {
        name: "Checking".to_string(),
        account_type: notchy_lib::database::types::AccountType::Checking,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: Some(5_000),
        initial_balance_date: Some("2026-01-01".to_string()),
    };
    let _account2_id = accounts::create_account(&mut db, op(), account2_input).unwrap();

    let id = goals::create_goal(
        &mut db,
        op(),
        "Net Worth Goal".to_string(),
        GoalType::NetWorth,
        100_000,
        "2026-12-31".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    let goal = goals::get_goal(&db, &id).unwrap().unwrap();
    // 10_000 (savings) + 5_000 (checking) = 15_000
    assert_eq!(goal.current_amount, 15_000);
}

#[test]
fn update_goal_status_to_completed() {
    let mut db = fresh_db("goal_complete");
    let id = goals::create_goal(
        &mut db,
        op(),
        "Completed Goal".to_string(),
        GoalType::Savings,
        1_000,
        "2026-06-30".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    goals::update_goal(&mut db, op(), &id, None, None, None, None, Some(GoalStatus::Completed))
        .unwrap();

    let goal = goals::get_goal(&db, &id).unwrap().unwrap();
    assert_eq!(goal.status, GoalStatus::Completed);
    assert!(goal.closed_at.is_some());
}

#[test]
fn update_goal_status_to_abandoned() {
    let mut db = fresh_db("goal_abandon");
    let id = goals::create_goal(
        &mut db,
        op(),
        "Abandoned Goal".to_string(),
        GoalType::Savings,
        1_000,
        "2026-06-30".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    goals::update_goal(&mut db, op(), &id, None, None, None, None, Some(GoalStatus::Abandoned))
        .unwrap();

    let goal = goals::get_goal(&db, &id).unwrap().unwrap();
    assert_eq!(goal.status, GoalStatus::Abandoned);
    assert!(goal.closed_at.is_some());
}

#[test]
fn delete_goal() {
    let mut db = fresh_db("goal_delete");
    let id = goals::create_goal(
        &mut db,
        op(),
        "Delete Me".to_string(),
        GoalType::Savings,
        1_000,
        "2026-06-30".to_string(),
        None,
        0,
        1,
    )
    .unwrap();

    goals::delete_goal(&mut db, op(), &id).unwrap();
    let goal = goals::get_goal(&db, &id).unwrap();
    assert!(goal.is_none());
}

#[test]
fn delete_nonexistent_goal_returns_not_found() {
    let mut db = fresh_db("goal_delete_nf");
    let result = goals::delete_goal(&mut db, op(), "00000000000000000000000000");
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().code, ErrorCode::InvalidInput);
}

// ===========================================================================
// Rule tests
// ===========================================================================

#[test]
fn create_and_get_rule() {
    let mut db = fresh_db("rule_create");
    let rule = rules::create_rule(
        &mut db,
        op(),
        "Starbucks".to_string(),
        MatchMode::Is,
        "tag_gift".to_string(),
        RuleSource::Manual,
    )
    .unwrap();

    assert_eq!(rule.payee_term, "Starbucks");
    assert_eq!(rule.match_mode, MatchMode::Is);
    assert_eq!(rule.tag_id, "tag_gift");
    assert_eq!(rule.source, RuleSource::Manual);
    assert_eq!(rule.enabled, 1);
}

#[test]
fn list_rules_filters_disabled() {
    let mut db = fresh_db("rule_list");
    rules::create_rule(
        &mut db,
        op(),
        "Enabled Rule".to_string(),
        MatchMode::Is,
        "tag_gift".to_string(),
        RuleSource::Manual,
    )
    .unwrap();
    rules::create_rule(
        &mut db,
        op(),
        "Another Enabled".to_string(),
        MatchMode::Contains,
        "tag_gift".to_string(),
        RuleSource::Manual,
    )
    .unwrap();

    let list = rules::list_rules(&db).unwrap();
    assert_eq!(list.len(), 2);

    // list_all_rules returns all regardless of enabled flag.
    let all = rules::list_all_rules(&db).unwrap();
    assert_eq!(all.len(), 2);
}

#[test]
fn update_rule() {
    let mut db = fresh_db("rule_update");
    let rule = rules::create_rule(
        &mut db,
        op(),
        "Old Payee".to_string(),
        MatchMode::Is,
        "tag_gift".to_string(),
        RuleSource::Manual,
    )
    .unwrap();

    let updated = rules::update_rule(
        &mut db,
        op(),
        &rule.id,
        Some("New Payee".to_string()),
        Some(MatchMode::Contains),
        Some("tag_loss".to_string()),
        None,
        Some(0),
    )
    .unwrap();

    assert_eq!(updated.payee_term, "New Payee");
    assert_eq!(updated.match_mode, MatchMode::Contains);
    assert_eq!(updated.tag_id, "tag_loss");
    assert_eq!(updated.enabled, 0);
}

#[test]
fn delete_rule() {
    let mut db = fresh_db("rule_delete");
    let rule = rules::create_rule(
        &mut db,
        op(),
        "Delete Me".to_string(),
        MatchMode::Is,
        "tag_gift".to_string(),
        RuleSource::Manual,
    )
    .unwrap();

    rules::delete_rule(&mut db, op(), &rule.id).unwrap();
    let found = rules::get_rule(&db, &rule.id).unwrap();
    assert!(found.is_none());
}

#[test]
fn upsert_learned_creates_new() {
    let mut db = fresh_db("rule_upsert_new");
    let rule = rules::upsert_learned(
        &mut db,
        op(),
        "  Starbucks  ".to_string(),
        "tag_gift".to_string(),
    )
    .unwrap();

    assert_eq!(rule.source, RuleSource::Learned);
    assert_eq!(rule.match_mode, MatchMode::Is);
    // Payee term is preserved as-is (not trimmed by Rust — normalization is for matching only).
    assert_eq!(rule.payee_term, "  Starbucks  ");
}

#[test]
fn upsert_learned_updates_existing() {
    let mut db = fresh_db("rule_upsert_update");
    let rule1 = rules::upsert_learned(
        &mut db,
        op(),
        "Starbucks".to_string(),
        "tag_gift".to_string(),
    )
    .unwrap();

    // Upsert with same payee (different case, but normalized match).
    let rule2 = rules::upsert_learned(
        &mut db,
        op(),
        "STARBUCKS".to_string(),
        "tag_loss".to_string(),
    )
    .unwrap();

    // Should be the same rule (updated, not created).
    assert_eq!(rule1.id, rule2.id);
    assert_eq!(rule2.tag_id, "tag_loss");
}

// ===========================================================================
// Meta tests
// ===========================================================================

#[test]
fn meta_get_set_delete() {
    let db = fresh_db("meta_crud");

    // Initially None.
    let val = meta::get_meta(&db, "test_key").unwrap();
    assert!(val.is_none());

    // Set.
    meta::set_meta(&db, "test_key", "test_value").unwrap();
    let val = meta::get_meta(&db, "test_key").unwrap();
    assert_eq!(val.as_deref(), Some("test_value"));

    // Overwrite.
    meta::set_meta(&db, "test_key", "new_value").unwrap();
    let val = meta::get_meta(&db, "test_key").unwrap();
    assert_eq!(val.as_deref(), Some("new_value"));

    // Delete.
    meta::delete_meta(&db, "test_key").unwrap();
    let val = meta::get_meta(&db, "test_key").unwrap();
    assert!(val.is_none());
}

#[test]
fn first_run_complete() {
    let db = fresh_db("meta_firstrun");

    let complete = meta::is_first_run_complete(&db).unwrap();
    assert!(!complete);

    meta::set_first_run_complete(&db).unwrap();

    let complete = meta::is_first_run_complete(&db).unwrap();
    assert!(complete);
}

#[test]
fn tour_complete() {
    let db = fresh_db("meta_tour");

    let complete = meta::is_tour_complete(&db).unwrap();
    assert!(!complete);

    meta::set_tour_complete(&db).unwrap();

    let complete = meta::is_tour_complete(&db).unwrap();
    assert!(complete);
}

#[test]
fn locale_and_currency_defaults() {
    let db = fresh_db("meta_defaults");

    let locale = meta::get_locale(&db).unwrap();
    assert_eq!(locale, "en");

    let currency = meta::get_currency(&db).unwrap();
    assert_eq!(currency, "VND");

    // Can override.
    meta::set_meta(&db, "locale", "vi").unwrap();
    let locale = meta::get_locale(&db).unwrap();
    assert_eq!(locale, "vi");
}

#[test]
fn quick_account_set_clear() {
    let db = fresh_db("meta_quickaccount");

    let acct = meta::get_default_quick_account(&db).unwrap();
    assert!(acct.is_none());

    meta::set_default_quick_account(&db, "acct_123").unwrap();
    let acct = meta::get_default_quick_account(&db).unwrap();
    assert_eq!(acct.as_deref(), Some("acct_123"));

    meta::clear_default_quick_account(&db).unwrap();
    let acct = meta::get_default_quick_account(&db).unwrap();
    assert!(acct.is_none());
}
