//! Task 14: all domain command wrappers registered with Tauri.

use std::sync::Arc;

use tauri::State;

use crate::database::domains;
use crate::database::error::{DbError, DbResult, ErrorCode, MetaKey};
use crate::database::executor::DatabaseManager;
use crate::database::startup::DatabaseStatus;
use crate::database::types::*;

/// The label of the only window permitted to request startup operations.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Reject callers that are not the main window.
pub(crate) fn assert_main_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> DbResult<()> {
    if window.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err(DbError::new(ErrorCode::InvalidInput))
    }
}

// ===========================================================================
// Lifecycle commands (main-window only)
// ===========================================================================

/// Initialize the native database boundary. Main-window only.
#[tauri::command]
pub async fn database_initialize<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.initialize().await
}

/// Retry a failed startup. Main-window only.
#[tauri::command]
pub async fn database_retry<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.retry().await
}

/// Query the current database status. Main-window only.
#[tauri::command]
pub async fn database_status<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.status()
}

/// Discover all verified backups available for restore, newest first.
/// Uses the manager's backup directory. Returns an empty list if the
/// directory does not exist.
#[tauri::command]
pub async fn discover_restore_points<R: tauri::Runtime>(
    _window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<BackupSummary>, DbError> {
    manager.discover_restore_points()
}

/// Replace the live database with a verified backup. Main-window only.
///
/// Accepts a `BackupSummary` (serializable) and reconstructs the
/// `BackupToken` internally by re-hashing the backup file.
#[tauri::command]
pub async fn database_restore<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
    summary: BackupSummary,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    let token = BackupToken::from_summary(&summary)?;
    manager.restore_database(token, crate::database::restore::RestoreFailurePoint::None).await
}

// ===========================================================================
// Account commands
// ===========================================================================

#[tauri::command]
pub async fn account_list(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<AccountWithBalance>, DbError> {
    manager.data_job(|state| domains::accounts::list_accounts(state.connection()?)).await
}

#[tauri::command]
pub async fn account_get(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<Option<AccountWithBalance>, DbError> {
    manager.data_job(move |state| domains::accounts::get_account(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn account_get_balance(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
) -> Result<i64, DbError> {
    let today = domains::accounts::today_iso();
    manager.data_job(move |state| domains::accounts::get_balance(state.connection()?, &account_id, &today)).await
}

#[tauri::command]
pub async fn account_get_balance_as_of(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
    date: String,
) -> Result<i64, DbError> {
    manager.data_job(move |state| domains::accounts::get_balance(state.connection()?, &account_id, &date)).await
}

#[tauri::command]
pub async fn account_create(
    manager: State<'_, Arc<DatabaseManager>>,
    input: NewAccount,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::accounts::create_account(state.connection_mut()?, op_id, input)
    }).await
}

#[tauri::command]
pub async fn account_update(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    patch: AccountPatch,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::accounts::update_account(state.connection_mut()?, op_id, &id, patch)
    }).await
}

#[tauri::command]
pub async fn account_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::accounts::delete_account(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn account_restore(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::accounts::restore_account(state.connection_mut()?, op_id, &id)
    }).await
}

// ===========================================================================
// Transaction commands
// ===========================================================================

#[tauri::command]
pub async fn transaction_list(
    manager: State<'_, Arc<DatabaseManager>>,
    filter: Option<TransactionFilter>,
) -> Result<Vec<Transaction>, DbError> {
    let f = filter.unwrap_or_default();
    manager.data_job(move |state| {
        domains::transactions::list_transactions(state.connection()?, f)
    }).await
}

#[tauri::command]
pub async fn transaction_get(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<Option<Transaction>, DbError> {
    manager.data_job(move |state| domains::transactions::get_transaction(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn transaction_create(
    manager: State<'_, Arc<DatabaseManager>>,
    input: NewTransaction,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::create_transaction(state.connection_mut()?, op_id, input)
    }).await
}

#[tauri::command]
pub async fn transaction_create_batch(
    manager: State<'_, Arc<DatabaseManager>>,
    inputs: Vec<NewTransaction>,
) -> Result<Vec<String>, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::create_transactions_batch(state.connection_mut()?, op_id, inputs)
    }).await
}

#[tauri::command]
pub async fn transaction_update(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    patch: TransactionPatch,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::update_transaction(state.connection_mut()?, op_id, &id, patch)
    }).await
}

#[tauri::command]
pub async fn transaction_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::delete_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn transaction_restore(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::restore_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn transaction_duplicate(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::transactions::duplicate_transaction(state.connection_mut()?, op_id, &id)
    }).await
}

// ===========================================================================
// Category commands
// ===========================================================================

#[tauri::command]
pub async fn category_list_buckets(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<Bucket>, DbError> {
    manager.data_job(|state| domains::categories::list_buckets(state.connection()?)).await
}

#[tauri::command]
pub async fn category_create_bucket(
    manager: State<'_, Arc<DatabaseManager>>,
    name: String,
    budgetable: Option<i32>,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::create_bucket(state.connection_mut()?, op_id, name, budgetable.unwrap_or(1))
    }).await
}

#[tauri::command]
pub async fn category_rename_bucket(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    name: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::rename_bucket(state.connection_mut()?, op_id, &id, name)
    }).await
}

#[tauri::command]
pub async fn category_set_rollover_enabled(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    enabled: bool,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::set_rollover_enabled(state.connection_mut()?, op_id, &id, enabled)
    }).await
}

#[tauri::command]
pub async fn category_delete_bucket(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::delete_bucket(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn category_list_tags(
    manager: State<'_, Arc<DatabaseManager>>,
    bucket_id: Option<String>,
) -> Result<Vec<Tag>, DbError> {
    manager.data_job(move |state| {
        domains::categories::list_tags(state.connection()?, bucket_id.as_deref())
    }).await
}

#[tauri::command]
pub async fn category_create_tag(
    manager: State<'_, Arc<DatabaseManager>>,
    name: String,
    bucket_id: String,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::create_tag(state.connection_mut()?, op_id, name, bucket_id)
    }).await
}

#[tauri::command]
pub async fn category_rename_tag(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    name: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::rename_tag(state.connection_mut()?, op_id, &id, name)
    }).await
}

#[tauri::command]
pub async fn category_move_tag(
    manager: State<'_, Arc<DatabaseManager>>,
    tag_id: String,
    new_bucket_id: String,
) -> Result<TagDeleteInfo, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::move_tag(state.connection_mut()?, op_id, &tag_id, new_bucket_id)
    }).await
}

#[tauri::command]
pub async fn category_get_tag_transaction_info(
    manager: State<'_, Arc<DatabaseManager>>,
    tag_id: String,
) -> Result<TagDeleteInfo, DbError> {
    manager.data_job(move |state| {
        domains::categories::get_tag_transaction_info(state.connection()?, &tag_id)
    }).await
}

#[tauri::command]
pub async fn category_delete_tag(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    option: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::categories::delete_tag(state.connection_mut()?, op_id, &id, &option)
    }).await
}

// ===========================================================================
// Budget commands
// ===========================================================================

#[tauri::command]
pub async fn budget_get_for_month(
    manager: State<'_, Arc<DatabaseManager>>,
    month: String,
) -> Result<Vec<BudgetSummary>, DbError> {
    manager.data_job(move |state| {
        domains::budgets::get_budgets_for_month(state.connection()?, &month)
    }).await
}

#[tauri::command]
pub async fn budget_get_spent_for_bucket(
    manager: State<'_, Arc<DatabaseManager>>,
    type_id: String,
    month: String,
) -> Result<i64, DbError> {
    manager.data_job(move |state| {
        domains::budgets::get_spent_for_bucket(state.connection()?, &type_id, &month)
    }).await
}

#[tauri::command]
pub async fn budget_get_rolled_over(
    manager: State<'_, Arc<DatabaseManager>>,
    type_id: String,
    month: String,
) -> Result<i64, DbError> {
    manager.data_job(move |state| {
        domains::budgets::get_rolled_over(state.connection()?, &type_id, &month)
    }).await
}

#[tauri::command]
pub async fn budget_set_allocation(
    manager: State<'_, Arc<DatabaseManager>>,
    type_id: String,
    month: String,
    allocated: i64,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::budgets::set_allocation(state.connection_mut()?, op_id, &type_id, &month, allocated)
    }).await
}

#[tauri::command]
pub async fn budget_copy_from_previous_month(
    manager: State<'_, Arc<DatabaseManager>>,
    target_month: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::budgets::copy_from_previous_month(state.connection_mut()?, op_id, &target_month)
    }).await
}

#[tauri::command]
pub async fn budget_has_allocations(
    manager: State<'_, Arc<DatabaseManager>>,
    month: String,
) -> Result<bool, DbError> {
    manager.data_job(move |state| {
        domains::budgets::has_allocations(state.connection()?, &month)
    }).await
}

// ===========================================================================
// Goal commands
// ===========================================================================

#[tauri::command]
pub async fn goal_list(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<GoalWithProgress>, DbError> {
    manager.data_job(|state| domains::goals::list_goals(state.connection()?)).await
}

#[tauri::command]
pub async fn goal_get(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<Option<GoalWithProgress>, DbError> {
    manager.data_job(move |state| domains::goals::get_goal(state.connection()?, &id)).await
}

#[tauri::command]
pub async fn goal_create(
    manager: State<'_, Arc<DatabaseManager>>,
    name: String,
    goal_type: String,
    target_amount: i64,
    target_date: String,
    linked_account_id: Option<String>,
    starting_amount: i64,
    show_on_dashboard: i64,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    let gt = match goal_type.as_str() {
        "savings" => GoalType::Savings,
        "debt_payoff" => GoalType::DebtPayoff,
        "net_worth" => GoalType::NetWorth,
        _ => return Err(DbError::new(ErrorCode::InvalidInput)),
    };
    manager.data_job(move |state| {
        domains::goals::create_goal(
            state.connection_mut()?, op_id, name, gt, target_amount,
            target_date, linked_account_id, starting_amount, show_on_dashboard,
        )
    }).await
}

#[tauri::command]
pub async fn goal_update(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    name: Option<String>,
    target_amount: Option<i64>,
    target_date: Option<String>,
    show_on_dashboard: Option<i64>,
    status: Option<String>,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    let gs = status.and_then(|s| match s.as_str() {
        "active" => Some(GoalStatus::Active),
        "completed" => Some(GoalStatus::Completed),
        "abandoned" => Some(GoalStatus::Abandoned),
        "overdue" => Some(GoalStatus::Overdue),
        _ => None,
    });
    manager.data_job(move |state| {
        domains::goals::update_goal(
            state.connection_mut()?, op_id, &id, name, target_amount,
            target_date, show_on_dashboard, gs,
        )
    }).await
}

#[tauri::command]
pub async fn goal_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::goals::delete_goal(state.connection_mut()?, op_id, &id)
    }).await
}

// ===========================================================================
// Rule commands
// ===========================================================================

#[tauri::command]
pub async fn rule_list(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<CategorizeRule>, DbError> {
    manager.data_job(|state| domains::rules::list_rules(state.connection()?)).await
}

#[tauri::command]
pub async fn rule_list_all(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Vec<CategorizeRule>, DbError> {
    manager.data_job(|state| domains::rules::list_all_rules(state.connection()?)).await
}

#[tauri::command]
pub async fn rule_create(
    manager: State<'_, Arc<DatabaseManager>>,
    payee_term: String,
    match_mode: String,
    tag_id: String,
    source: String,
) -> Result<CategorizeRule, DbError> {
    let op_id = OperationId::generate();
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
    manager.data_job(move |state| {
        domains::rules::create_rule(state.connection_mut()?, op_id, payee_term, mm, tag_id, src)
    }).await
}

#[tauri::command]
pub async fn rule_update(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
    payee_term: Option<String>,
    match_mode: Option<String>,
    tag_id: Option<String>,
    source: Option<String>,
    enabled: Option<i64>,
) -> Result<CategorizeRule, DbError> {
    let op_id = OperationId::generate();
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
    manager.data_job(move |state| {
        domains::rules::update_rule(state.connection_mut()?, op_id, &id, payee_term, mm, tag_id, src, enabled)
    }).await
}

#[tauri::command]
pub async fn rule_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    id: String,
) -> Result<(), DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::rules::delete_rule(state.connection_mut()?, op_id, &id)
    }).await
}

#[tauri::command]
pub async fn rule_upsert_learned(
    manager: State<'_, Arc<DatabaseManager>>,
    payee_term: String,
    tag_id: String,
) -> Result<CategorizeRule, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::rules::upsert_learned(state.connection_mut()?, op_id, payee_term, tag_id)
    }).await
}

// ===========================================================================
// Meta commands
// ===========================================================================

#[tauri::command]
pub async fn meta_get(
    manager: State<'_, Arc<DatabaseManager>>,
    key: String,
) -> Result<Option<String>, DbError> {
    manager.data_job(move |state| domains::meta::get_meta(state.connection()?, &key)).await
}

#[tauri::command]
pub async fn meta_set(
    manager: State<'_, Arc<DatabaseManager>>,
    key: String,
    value: String,
) -> Result<(), DbError> {
    manager.data_job(move |state| domains::meta::set_meta(state.connection()?, &key, &value)).await
}

#[tauri::command]
pub async fn meta_delete(
    manager: State<'_, Arc<DatabaseManager>>,
    key: String,
) -> Result<(), DbError> {
    manager.data_job(move |state| domains::meta::delete_meta(state.connection()?, &key)).await
}

#[tauri::command]
pub async fn meta_is_first_run_complete(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<bool, DbError> {
    manager.data_job(|state| domains::meta::is_first_run_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_locale(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<String, DbError> {
    manager.data_job(|state| domains::meta::get_locale(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_currency(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<String, DbError> {
    manager.data_job(|state| domains::meta::get_currency(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_is_tour_complete(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<bool, DbError> {
    manager.data_job(|state| domains::meta::is_tour_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_tour_complete(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<(), DbError> {
    manager.data_job(|state| domains::meta::set_tour_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_first_run_complete(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<(), DbError> {
    manager.data_job(|state| domains::meta::set_first_run_complete(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_get_default_quick_account(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<Option<String>, DbError> {
    manager.data_job(|state| domains::meta::get_default_quick_account(state.connection()?)).await
}

#[tauri::command]
pub async fn meta_set_default_quick_account(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
) -> Result<(), DbError> {
    manager.data_job(move |state| {
        domains::meta::set_default_quick_account(state.connection()?, &account_id)
    }).await
}

#[tauri::command]
pub async fn meta_clear_default_quick_account(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<(), DbError> {
    manager.data_job(|state| domains::meta::clear_default_quick_account(state.connection()?)).await
}

// ===========================================================================
// Debt commands
// ===========================================================================

#[tauri::command]
pub async fn debt_list(
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DebtSummary, DbError> {
    manager.data_job(|state| domains::debts::list_debts(state.connection()?)).await
}

#[tauri::command]
pub async fn debt_write_off(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
    amount: i64,
    tag_id: String,
) -> Result<String, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
        domains::debts::write_off(state.connection_mut()?, op_id, &account_id, amount, &tag_id)
    }).await
}

// ===========================================================================
// Reconciliation commands
// ===========================================================================

#[tauri::command]
pub async fn reconciliation_get_history(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
) -> Result<Vec<Reconciliation>, DbError> {
    manager.data_job(move |state| {
        domains::reconciliations::get_reconciliation_history(state.connection()?, &account_id)
    }).await
}

#[tauri::command]
pub async fn reconciliation_reconcile(
    manager: State<'_, Arc<DatabaseManager>>,
    account_id: String,
    actual_balance: i64,
    create_adjustment: bool,
    notes: Option<String>,
) -> Result<ReconcileResult, DbError> {
    let op_id = OperationId::generate();
    manager.data_job(move |state| {
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
    manager: State<'_, Arc<DatabaseManager>>,
    month: String,
    include_adjustments: Option<bool>,
) -> Result<OverviewReport, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_overview(state.connection()?, &month, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_trend(
    manager: State<'_, Arc<DatabaseManager>>,
    months: u32,
    include_adjustments: Option<bool>,
    _bucket_id: Option<String>,
) -> Result<Vec<TrendPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_trend(state.connection()?, months, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_comparison(
    manager: State<'_, Arc<DatabaseManager>>,
    month_a: String,
    month_b: String,
    include_adjustments: Option<bool>,
) -> Result<Vec<CompareRow>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_comparison(state.connection()?, &month_a, &month_b, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_category_trend(
    manager: State<'_, Arc<DatabaseManager>>,
    tag_id: String,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<CategoryTrendPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_category_trend(state.connection()?, months, &tag_id, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_stacked_category_series(
    manager: State<'_, Arc<DatabaseManager>>,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<StackedCategoryPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_stacked_category_series(state.connection()?, months, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_year_over_year(
    manager: State<'_, Arc<DatabaseManager>>,
    year_a: i32,
    year_b: i32,
    include_adjustments: Option<bool>,
) -> Result<Vec<YearOverYearPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_year_over_year(state.connection()?, year_a, year_b, inc)
    }).await
}

#[tauri::command]
pub async fn report_get_net_worth_series(
    manager: State<'_, Arc<DatabaseManager>>,
    months: u32,
    include_adjustments: Option<bool>,
) -> Result<Vec<NetWorthPoint>, DbError> {
    let inc = include_adjustments.unwrap_or(false);
    manager.data_job(move |state| {
        domains::reports::get_net_worth_series(state.connection()?, months, inc)
    }).await
}

// ===========================================================================
// Binding generator
// ===========================================================================

use ts_rs::{Config, TS};

/// Header written above the generated bindings.
const GENERATED_HEADER: &str = "\
// This file is generated by `pnpm generate:db-contracts` from the native contract
// types in src-tauri/src/database/{error,types}.rs. Do not edit by hand.
";

/// Generate the complete TypeScript bindings for the native database contracts.
pub fn generate_bindings() -> String {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');

    let cfg = Config::default().with_large_int("number");

    push_decl(&mut out, ErrorCode::decl(&cfg));
    push_decl(&mut out, MetaKey::decl(&cfg));
    push_decl(&mut out, DbError::decl(&cfg));
    push_decl(&mut out, LifecycleState::decl(&cfg));
    push_decl(&mut out, StartupStage::decl(&cfg));
    push_decl(&mut out, RecoveryContext::decl(&cfg));
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

    push_decl(&mut out, BackupHealth::decl(&cfg));
    push_decl(&mut out, BackupHealthOptions::decl(&cfg));

    out
}

fn push_decl(out: &mut String, decl: String) {
    out.push_str("export ");
    out.push_str(decl.trim());
    out.push('\n');
}
