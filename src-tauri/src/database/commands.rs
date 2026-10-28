//! Task 14: all domain command wrappers registered with Tauri.

use std::sync::Arc;

use tauri::State;

use crate::database::domains;
use crate::database::automatic_backup::AutomaticBackupStatus;
use crate::database::error::{DbError, ErrorCode, MetaKey};
use crate::profiles::coordinator::ProfileCoordinator;
use crate::profiles::types::ProfileSession;
use crate::database::startup::DatabaseStatus;
use crate::database::types::*;

// ===========================================================================
// Retired single-database lifecycle commands
// ===========================================================================
// Kept as fail-closed compatibility endpoints while old web adapters are
// removed. ProfileCoordinator::bootstrap owns startup, and restore is always
// a new profile through profile_inspect_restore/profile_restore.
fn retired_lifecycle() -> DbError { DbError::new(ErrorCode::InvalidInput) }

#[tauri::command]
pub async fn database_initialize(_coordinator: State<'_, Arc<ProfileCoordinator>>) -> Result<DatabaseStatus, DbError> { Err(retired_lifecycle()) }
#[tauri::command]
pub async fn database_retry(_coordinator: State<'_, Arc<ProfileCoordinator>>) -> Result<DatabaseStatus, DbError> { Err(retired_lifecycle()) }
#[tauri::command]
pub async fn database_status(_coordinator: State<'_, Arc<ProfileCoordinator>>) -> Result<DatabaseStatus, DbError> { Err(retired_lifecycle()) }
#[tauri::command]
pub async fn discover_restore_points(_coordinator: State<'_, Arc<ProfileCoordinator>>) -> Result<Vec<BackupSummary>, DbError> { Err(retired_lifecycle()) }
#[tauri::command]
pub async fn database_restore(_coordinator: State<'_, Arc<ProfileCoordinator>>, _summary: BackupSummary) -> Result<DatabaseStatus, DbError> { let _ = _summary; Err(retired_lifecycle()) }
#[tauri::command]
pub async fn database_import(_coordinator: State<'_, Arc<ProfileCoordinator>>, _source_path: String) -> Result<i64, DbError> { let _ = _source_path; Err(retired_lifecycle()) }

// ===========================================================================
// Account commands
// ===========================================================================

#[tauri::command]
pub async fn account_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<AccountWithBalance>, DbError> {
    coordinator.with_session(&session, |state| domains::accounts::list_accounts(state.connection()?)).await
}

#[tauri::command]
pub async fn account_get(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
) -> Result<Option<AccountWithBalance>, DbError> {
    coordinator.with_session(&session, move |state| domains::accounts::get_account(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn account_get_balance(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
) -> Result<i64, DbError> {
    let today = domains::accounts::today_iso();
    coordinator.with_session(&session, move |state| domains::accounts::get_balance(state.connection()?, &account_id, &today)).await
}

#[tauri::command]
pub async fn account_get_balance_as_of(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
    date: String,
) -> Result<i64, DbError> {
    coordinator.with_session(&session, move |state| domains::accounts::get_balance(state.connection()?, &account_id, &date)).await
}

#[tauri::command]
pub async fn account_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    input: NewAccount,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::accounts::create_account(state.connection_mut()?, op_id, input)
    }).await
}

#[tauri::command]
pub async fn account_update(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    patch: AccountPatch,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::accounts::update_account(state.connection_mut()?, op_id, &id, patch)
    }).await
}

#[tauri::command]
pub async fn account_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::accounts::delete_account(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn account_restore(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::accounts::restore_account(state.connection_mut()?, op_id, &id)
    }).await
}

// ===========================================================================
// Transaction commands
// ===========================================================================

#[tauri::command]
pub async fn transaction_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    filter: Option<TransactionFilter>,
) -> Result<Vec<Transaction>, DbError> {
    let f = filter.unwrap_or_default();
    coordinator.with_session(&session, move |state| {
        domains::transactions::list_transactions(state.connection()?, f)
    }).await
}

#[tauri::command]
pub async fn transaction_get(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
) -> Result<Option<Transaction>, DbError> {
    coordinator.with_session(&session, move |state| domains::transactions::get_transaction(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn transaction_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    input: NewTransaction,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::create_transaction(state.connection_mut()?, op_id, input)
    }).await
}

#[tauri::command]
pub async fn transaction_create_batch(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    inputs: Vec<NewTransaction>,
    operation_id: OperationId,
) -> Result<Vec<String>, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::create_transactions_batch(state.connection_mut()?, op_id, inputs)
    }).await
}

#[tauri::command]
pub async fn transaction_update(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    patch: TransactionPatch,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::update_transaction(state.connection_mut()?, op_id, &id, patch)
    }).await
}

#[tauri::command]
pub async fn transaction_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::delete_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn transaction_restore(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::restore_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn transaction_duplicate(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::transactions::duplicate_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn transaction_frequent(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    since_date: String,
) -> Result<Vec<FrequentTx>, DbError> {
    coordinator
        .with_session(&session, move |state| domains::transactions::get_frequent(state.connection()?, &since_date))
        .await
}

#[tauri::command]
pub async fn transaction_delete_many(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    ids: Vec<String>,
    operation_id: OperationId,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::transactions::delete_transactions(state.connection_mut()?, op_id, ids)
        })
        .await
}
#[tauri::command]
pub async fn transaction_set_tag_many(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    ids: Vec<String>,
    tag_id: Option<String>,
    operation_id: OperationId,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::transactions::set_tag_many(state.connection_mut()?, op_id, ids, tag_id)
        })
        .await
}
#[tauri::command]
pub async fn transaction_set_account_many(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    ids: Vec<String>,
    account_id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::transactions::set_account_many(state.connection_mut()?, op_id, ids, account_id)
        })
        .await
}

// ===========================================================================
// Category commands
// ===========================================================================

#[tauri::command]
pub async fn category_list_buckets(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<Bucket>, DbError> {
    coordinator.with_session(&session, |state| domains::categories::list_buckets(state.connection()?)).await
}

#[tauri::command]
pub async fn category_create_bucket(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    name: String,
    budgetable: Option<i32>,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::create_bucket(state.connection_mut()?, op_id, name, budgetable.unwrap_or(1))
    }).await
}

#[tauri::command]
pub async fn category_rename_bucket(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    name: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::rename_bucket(state.connection_mut()?, op_id, &id, name)
    }).await
}

#[tauri::command]
pub async fn category_set_rollover_enabled(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    enabled: bool,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::set_rollover_enabled(state.connection_mut()?, op_id, &id, enabled)
    }).await
}

#[tauri::command]
pub async fn category_delete_bucket(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::delete_bucket(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn category_list_tags(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    bucket_id: Option<String>,
) -> Result<Vec<Tag>, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::categories::list_tags(state.connection()?, bucket_id.as_deref())
    }).await
}

#[tauri::command]
pub async fn category_create_tag(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    name: String,
    bucket_id: String,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::create_tag(state.connection_mut()?, op_id, name, bucket_id)
    }).await
}

#[tauri::command]
pub async fn category_rename_tag(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    name: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::rename_tag(state.connection_mut()?, op_id, &id, name)
    }).await
}

#[tauri::command]
pub async fn category_move_tag(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    tag_id: String,
    new_bucket_id: String,
    operation_id: OperationId,
) -> Result<TagDeleteInfo, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::move_tag(state.connection_mut()?, op_id, &tag_id, new_bucket_id)
    }).await
}

#[tauri::command]
pub async fn category_get_tag_transaction_info(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    tag_id: String,
) -> Result<TagDeleteInfo, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::categories::get_tag_transaction_info(state.connection()?, &tag_id)
    }).await
}

#[tauri::command]
pub async fn category_delete_tag(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    option: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::categories::delete_tag(state.connection_mut()?, op_id, &id, &option)
    }).await
}

// ===========================================================================
// Budget commands
// ===========================================================================

#[tauri::command]
pub async fn budget_get_for_month(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    month: String,
) -> Result<Vec<BudgetSummary>, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::budgets::get_budgets_for_month(state.connection()?, &month)
    }).await
}

#[tauri::command]
pub async fn budget_get_spent_for_bucket(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    type_id: String,
    month: String,
) -> Result<i64, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::budgets::get_spent_for_bucket(state.connection()?, &type_id, &month)
    }).await
}

#[tauri::command]
pub async fn budget_get_rolled_over(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    type_id: String,
    month: String,
) -> Result<i64, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::budgets::get_rolled_over(state.connection()?, &type_id, &month)
    }).await
}

#[tauri::command]
pub async fn budget_get_to_budget(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    month: String,
) -> Result<ToBudgetBreakdown, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::budgets::get_to_budget(state.connection()?, &month)
    }).await
}

#[tauri::command]
pub async fn budget_set_allocation(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    type_id: String,
    month: String,
    allocated: i64,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::budgets::set_allocation(state.connection_mut()?, op_id, &type_id, &month, allocated)
    }).await
}

#[tauri::command]
pub async fn budget_copy_from_previous_month(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    target_month: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::budgets::copy_from_previous_month(state.connection_mut()?, op_id, &target_month)
    }).await
}

#[tauri::command]
pub async fn budget_has_allocations(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    month: String,
) -> Result<bool, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::budgets::has_allocations(state.connection()?, &month)
    }).await
}

// ===========================================================================
// Goal commands
// ===========================================================================

#[tauri::command]
pub async fn goal_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<GoalWithProgress>, DbError> {
    coordinator.with_session(&session, |state| domains::goals::list_goals(state.connection()?)).await
}

#[tauri::command]
pub async fn goal_get(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
) -> Result<Option<GoalWithProgress>, DbError> {
    coordinator.with_session(&session, move |state| domains::goals::get_goal(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn goal_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    name: String,
    goal_type: String,
    target_amount: i64,
    target_date: String,
    linked_account_id: Option<String>,
    starting_amount: i64,
    show_on_dashboard: i64,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    let gt = match goal_type.as_str() {
        "savings" => GoalType::Savings,
        "debt_payoff" => GoalType::DebtPayoff,
        "net_worth" => GoalType::NetWorth,
        _ => return Err(DbError::new(ErrorCode::InvalidInput)),
    };
    coordinator.with_session(&session, move |state| {
        domains::goals::create_goal(
            state.connection_mut()?, op_id, name, gt, target_amount,
            target_date, linked_account_id, starting_amount, show_on_dashboard,
        )
    }).await
}

#[tauri::command]
pub async fn goal_update(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    name: Option<String>,
    target_amount: Option<i64>,
    target_date: Option<String>,
    show_on_dashboard: Option<i64>,
    status: Option<String>,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    let gs = status.and_then(|s| match s.as_str() {
        "active" => Some(GoalStatus::Active),
        "completed" => Some(GoalStatus::Completed),
        "abandoned" => Some(GoalStatus::Abandoned),
        "overdue" => Some(GoalStatus::Overdue),
        _ => None,
    });
    coordinator.with_session(&session, move |state| {
        domains::goals::update_goal(
            state.connection_mut()?, op_id, &id, name, target_amount,
            target_date, show_on_dashboard, gs,
        )
    }).await
}

#[tauri::command]
pub async fn goal_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::goals::delete_goal(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn goal_restore(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::goals::restore_goal(state.connection_mut()?, op_id, &id)
    }).await
}

// ===========================================================================
// Rule commands
// ===========================================================================

#[tauri::command]
pub async fn rule_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<CategorizeRule>, DbError> {
    coordinator.with_session(&session, |state| domains::rules::list_rules(state.connection()?)).await
}

#[tauri::command]
pub async fn rule_list_all(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<CategorizeRule>, DbError> {
    coordinator.with_session(&session, |state| domains::rules::list_all_rules(state.connection()?)).await
}

#[tauri::command]
pub async fn rule_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    payee_term: String,
    match_mode: String,
    tag_id: String,
    source: String,
    operation_id: OperationId,
) -> Result<CategorizeRule, DbError> {
    let op_id = operation_id;
    let mm = match match_mode.as_str() {
        "is" => MatchMode::Is,
        "starts_with" => MatchMode::StartsWith,
        "contains" => MatchMode::Contains,
        _ => return Err(DbError::new(ErrorCode::InvalidInput)),
    };
    let src = match source.as_str() {
        "manual" => RuleSource::Manual,
        "learned" => RuleSource::Learned,
        _ => return Err(DbError::new(ErrorCode::InvalidInput)),
    };
    coordinator.with_session(&session, move |state| {
        domains::rules::create_rule(state.connection_mut()?, op_id, payee_term, mm, tag_id, src)
    }).await
}

#[tauri::command]
pub async fn rule_update(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    payee_term: Option<String>,
    match_mode: Option<String>,
    tag_id: Option<String>,
    source: Option<String>,
    enabled: Option<i64>,
    operation_id: OperationId,
) -> Result<CategorizeRule, DbError> {
    let op_id = operation_id;
    let mm = match_mode.and_then(|s| match s.as_str() {
        "is" => Some(MatchMode::Is),
        "starts_with" => Some(MatchMode::StartsWith),
        "contains" => Some(MatchMode::Contains),
        _ => None,
    });
    let src = source.and_then(|s| match s.as_str() {
        "manual" => Some(RuleSource::Manual),
        "learned" => Some(RuleSource::Learned),
        _ => None,
    });
    coordinator.with_session(&session, move |state| {
        domains::rules::update_rule(state.connection_mut()?, op_id, &id, payee_term, mm, tag_id, src, enabled)
    }).await
}

#[tauri::command]
pub async fn rule_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::rules::delete_rule(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn rule_upsert_learned(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    payee_term: String,
    tag_id: String,
    operation_id: OperationId,
) -> Result<CategorizeRule, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::rules::upsert_learned(state.connection_mut()?, op_id, payee_term, tag_id)
    }).await
}

// ===========================================================================
// Meta commands
// ===========================================================================

#[tauri::command]
pub async fn meta_get(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    key: String,
) -> Result<Option<String>, DbError> {
    coordinator.with_session(&session, move |state| domains::meta::get_meta(state.connection()?, &key)).await
}

#[tauri::command]
pub async fn meta_set(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    key: String,
    value: String,
) -> Result<(), DbError> {
    coordinator.with_session(&session, move |state| domains::meta::set_meta(state.connection()?, &key, &value)).await
}

#[tauri::command]
pub async fn meta_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    key: String,
) -> Result<(), DbError> {
    coordinator.with_session(&session, move |state| domains::meta::delete_meta(state.connection()?, &key)).await
}

#[tauri::command]
pub async fn meta_is_first_run_complete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<bool, DbError> {
    coordinator.with_session(&session, |state| domains::meta::is_first_run_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_locale(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<String, DbError> {
    coordinator.with_session(&session, |state| domains::meta::get_locale(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_currency(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<String, DbError> {
    coordinator.with_session(&session, |state| domains::meta::get_currency(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_is_tour_complete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<bool, DbError> {
    coordinator.with_session(&session, |state| domains::meta::is_tour_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_tour_complete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<(), DbError> {
    coordinator.with_session(&session, |state| domains::meta::set_tour_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_first_run_complete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<(), DbError> {
    coordinator.with_session(&session, |state| domains::meta::set_first_run_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_default_quick_account(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Option<String>, DbError> {
    coordinator.with_session(&session, |state| domains::meta::get_default_quick_account(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_default_quick_account(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
) -> Result<(), DbError> {
    coordinator.with_session(&session, move |state| {
        domains::meta::set_default_quick_account(state.connection()?, &account_id)
    }).await
}

#[tauri::command]
pub async fn meta_clear_default_quick_account(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<(), DbError> {
    coordinator.with_session(&session, |state| domains::meta::clear_default_quick_account(state.connection()?)).await
}

// ===========================================================================
// Debt commands
// ===========================================================================

#[tauri::command]
pub async fn debt_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<DebtSummary, DbError> {
    coordinator.with_session(&session, |state| domains::debts::list_debts(state.connection()?)).await
}

#[tauri::command]
pub async fn debt_write_off(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
    amount: i64,
    tag_id: Option<String>,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::debts::write_off(state.connection_mut()?, op_id, &account_id, amount, tag_id)
    }).await
}

// ===========================================================================
// Reconciliation commands
// ===========================================================================

#[tauri::command]
pub async fn reconciliation_get_history(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
) -> Result<Vec<Reconciliation>, DbError> {
    coordinator.with_session(&session, move |state| {
        domains::reconciliations::get_reconciliation_history(state.connection()?, &account_id)
    }).await
}

#[tauri::command]
pub async fn reconciliation_reconcile(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    account_id: String,
    actual_balance: i64,
    create_adjustment: bool,
    notes: Option<String>,
    operation_id: OperationId,
) -> Result<ReconcileResult, DbError> {
    let op_id = operation_id;
    coordinator.with_session(&session, move |state| {
        domains::reconciliations::reconcile(
            state.connection_mut()?, op_id, &account_id, actual_balance, create_adjustment, notes,
        )
    }).await
}

// ===========================================================================
// Report commands
// ===========================================================================

#[tauri::command]
pub async fn report_get_overview(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    month: String,
    include_adjustments: Option<bool>,
) -> Result<OverviewReport, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_overview(state.connection()?, &month, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_trend(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    months: u32,
    include_adjustments: Option<bool>,
    bucket_id: Option<String>,
) -> Result<Vec<TrendPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_trend(state.connection()?, months, inc, bucket_id.as_deref())
    }).await
}

#[tauri::command]
pub async fn report_get_comparison(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    month_a: String,
    month_b: String,
    include_adjustments: Option<bool>,
) -> Result<Vec<CompareRow>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_comparison(state.connection()?, &month_a, &month_b, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_category_trend(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    tag_id: String,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<CategoryTrendPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_category_trend(state.connection()?, months, &tag_id, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_stacked_category_series(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<StackedCategoryPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_stacked_category_series(state.connection()?, months, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_year_over_year(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    year_a: i32,
    year_b: i32,
    include_adjustments: Option<bool>,
) -> Result<Vec<YearOverYearPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_year_over_year(state.connection()?, year_a, year_b, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_net_worth_series(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<NetWorthPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    coordinator.with_session(&session, move |state| {
        domains::reports::get_net_worth_series(state.connection()?, months, inc)
    }).await
}

// ===========================================================================
// Backup commands
// ===========================================================================

/// Publish a routine backup into the app's backup directory and return its path.
#[tauri::command]
pub async fn backup_automatic_status(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<AutomaticBackupStatus, DbError> {
    coordinator.automatic_backup_status(&session).await
}

#[tauri::command]
pub async fn backup_automatic_set_enabled(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    enabled: bool,
    operation_id: OperationId,
) -> Result<(), DbError> {
    coordinator.set_automatic_backup_enabled(&session, enabled, operation_id).await
}

#[tauri::command]
pub async fn backup_automatic_check(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<AutomaticBackupStatus, DbError> {
    coordinator.check_automatic_backup(&session).await
}

#[tauri::command]
pub async fn backup_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<String, DbError> {
    coordinator.backup_for_session(&session).await.map(|token| token.id().to_owned())
}

#[tauri::command]
pub async fn backup_export_sqlite(
    target_path: String,
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<(), DbError> {
    coordinator.export_backup_for_session(&session, std::path::Path::new(&target_path)).await.map(|_| ())
}

#[tauri::command]
pub async fn backup_export_csv(
    dir: String,
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<String>, DbError> {
    coordinator.with_session(&session, move |state| {
        crate::database::domains::export::export_table_set_csv(state.connection()?, std::path::Path::new(&dir))
    }).await
}

// ===========================================================================
// Schedule commands
// ===========================================================================

#[tauri::command]
pub async fn schedule_list(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
) -> Result<Vec<Schedule>, DbError> {
    coordinator.with_session(&session, |state| domains::schedules::list_schedules(state.connection()?)).await
}

#[tauri::command]
pub async fn schedule_list_due(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    today: String,
) -> Result<Vec<Schedule>, DbError> {
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::list_due_schedules(state.connection()?, &today)
        })
        .await
}

#[tauri::command]
pub async fn schedule_create(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    input: NewSchedule,
    operation_id: OperationId,
) -> Result<String, DbError> {
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::create_schedule(state.connection_mut()?, op_id, input)
        })
        .await
}

#[tauri::command]
pub async fn schedule_update(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    input: ScheduleUpdate,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::update_schedule(state.connection_mut()?, op_id, &id, input)
        })
        .await
}

#[tauri::command]
pub async fn schedule_delete(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::delete_schedule(state.connection_mut()?, op_id, &id)
        })
        .await
}

#[tauri::command]
pub async fn schedule_mark_posted(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    last_posted_date: Option<String>,
    next_due_date: Option<String>,
    completed: i64,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::mark_schedule_posted(
                state.connection_mut()?,
                op_id,
                &id,
                last_posted_date,
                next_due_date,
                completed,
            )
        })
        .await
}

#[tauri::command]
pub async fn schedule_mark_errored(
    coordinator: State<'_, Arc<ProfileCoordinator>>,
    session: ProfileSession,
    id: String,
    operation_id: OperationId,
) -> Result<(), DbError> {
    let op_id = operation_id;
    coordinator
        .with_session(&session, move |state| {
            domains::schedules::mark_schedule_errored(state.connection_mut()?, op_id, &id)
        })
        .await
}

// ===========================================================================
// Binding generator
// ===========================================================================

use ts_rs::{Config, TS};

/// Header written above the generated bindings.
const GENERATED_HEADER: &str = "\
// This file is generated by `pnpm generate:db-contracts` from the native contract
// types in src-tauri/src/database/ and profiles/. Do not edit by hand.
";

/// Generate the complete TypeScript bindings for the native database contracts.
pub fn generate_bindings() -> String {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');

    let cfg = Config::default().with_large_int("number");

    push_decl(&mut out, ErrorCode::decl(&cfg));
    push_error_code_values(&mut out);
    push_decl(&mut out, MetaKey::decl(&cfg));
    push_decl(&mut out, DbError::decl(&cfg));
    push_decl(&mut out, LifecycleState::decl(&cfg));
    push_decl(&mut out, StartupStage::decl(&cfg));
    push_decl(&mut out, RecoveryContext::decl(&cfg));
    push_decl(&mut out, BackupSummary::decl(&cfg));
    push_decl(&mut out, AutomaticBackupStatus::decl(&cfg));
    push_decl(&mut out, crate::database::clock::BackupClock::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::ProfileRecord::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::ProfileRegistry::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::AppPreferences::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::ProfileSession::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::ProfileRecovery::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::ProfileSnapshot::decl(&cfg));
    push_decl(&mut out, crate::profiles::types::OperationContext::decl(&cfg));
    push_decl(&mut out, crate::profiles::backup::RestorePreview::decl(&cfg));
    push_decl(&mut out, crate::profiles::delete::DeleteResult::decl(&cfg));
    push_decl(&mut out, crate::profiles::commands::ProfileStoragePaths::decl(&cfg));
    push_decl(&mut out, crate::profiles::windows::TransitionRequest::decl(&cfg));
    push_decl(&mut out, OperationId::decl(&cfg));
    push_decl(&mut out, IsoDate::decl(&cfg));
    push_decl(&mut out, Page::<i64>::decl(&cfg));
    push_decl(&mut out, Patch::<i64>::decl(&cfg));

    push_decl(&mut out, AccountType::decl(&cfg));
    push_decl(&mut out, Account::decl(&cfg));
    push_decl(&mut out, AccountWithBalance::decl(&cfg));
    push_decl(&mut out, NewAccount::decl(&cfg));
    push_decl(&mut out, AccountPatch::decl(&cfg));
    push_decl(&mut out, TransactionKind::decl(&cfg));
    push_decl(&mut out, Transaction::decl(&cfg));
    push_decl(&mut out, NewTransaction::decl(&cfg));
    push_decl(&mut out, TransactionFilter::decl(&cfg));
    push_decl(&mut out, TransactionPatch::decl(&cfg));

    push_decl(&mut out, Bucket::decl(&cfg));
    push_decl(&mut out, Tag::decl(&cfg));
    push_decl(&mut out, TagDeleteInfo::decl(&cfg));
    push_decl(&mut out, Budget::decl(&cfg));
    push_decl(&mut out, BudgetSummary::decl(&cfg));
    push_decl(&mut out, ToBudgetBreakdown::decl(&cfg));

    push_decl(&mut out, Reconciliation::decl(&cfg));
    push_decl(&mut out, ReconcileResult::decl(&cfg));
    push_decl(&mut out, DebtAccount::decl(&cfg));
    push_decl(&mut out, DebtSummary::decl(&cfg));

    push_decl(&mut out, GoalType::decl(&cfg));
    push_decl(&mut out, GoalStatus::decl(&cfg));
    push_decl(&mut out, VelocityStatus::decl(&cfg));
    push_decl(&mut out, Goal::decl(&cfg));
    push_decl(&mut out, GoalWithProgress::decl(&cfg));

    push_decl(&mut out, MatchMode::decl(&cfg));
    push_decl(&mut out, RuleSource::decl(&cfg));
    push_decl(&mut out, CategorizeRule::decl(&cfg));

    push_decl(&mut out, BucketSpending::decl(&cfg));
    push_decl(&mut out, TagSpending::decl(&cfg));
    push_decl(&mut out, TopTransaction::decl(&cfg));
    push_decl(&mut out, OverviewReport::decl(&cfg));
    push_decl(&mut out, TrendPoint::decl(&cfg));
    push_decl(&mut out, CompareRow::decl(&cfg));
    push_decl(&mut out, CategoryTrendPoint::decl(&cfg));
    push_decl(&mut out, StackedTag::decl(&cfg));
    push_decl(&mut out, StackedCategoryPoint::decl(&cfg));
    push_decl(&mut out, YearOverYearPoint::decl(&cfg));
    push_decl(&mut out, NetWorthPoint::decl(&cfg));

    push_decl(&mut out, ScheduleKind::decl(&cfg));
    push_decl(&mut out, ScheduleFrequency::decl(&cfg));
    push_decl(&mut out, Schedule::decl(&cfg));
    push_decl(&mut out, NewSchedule::decl(&cfg));
    push_decl(&mut out, ScheduleUpdate::decl(&cfg));
    push_decl(&mut out, SchedulePostResult::decl(&cfg));

    out
}

fn push_decl(out: &mut String, decl: String) {
    out.push_str("export ");
    for line in decl.trim().lines() {
        out.push_str(line.trim_end());
        out.push('\n');
    }
}
/// Append the runtime list of every error code.
///
/// `ErrorCodeValues` is not a ts_rs type, so it is emitted by hand — but the
/// iteration is driven by [`ErrorCode::ALL`], which keeps the enum, the
/// generated union, and this array from drifting independently.
fn push_error_code_values(out: &mut String) {
    out.push_str("export const ErrorCodeValues = [\n");
    for code in ErrorCode::ALL {
        out.push_str("\t'");
        out.push_str(code.as_str());
        out.push_str("',\n");
    }
    out.push_str("] as const satisfies readonly ErrorCode[];\n");
}

#[tauri::command]
pub async fn schedule_post_due(coordinator: State<'_, Arc<ProfileCoordinator>>, session: ProfileSession, id: String, today: IsoDate, operation_id: OperationId) -> Result<SchedulePostResult, DbError> {
 coordinator.with_session(&session, move |state| domains::schedules::post_due_schedule(state.connection_mut()?,operation_id,&id,today)).await
}
