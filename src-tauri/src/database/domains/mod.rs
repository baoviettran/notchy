//! Domain services for accounts, transactions, categories, budgets, goals,
//! rules, and meta.
//!
//! Every mutation goes through `run_idempotent`; read-only operations query
//! directly. Business rules are ported 1:1 from the TypeScript repositories.

pub mod accounts;
pub mod budgets;
pub mod categories;
pub mod debts;
pub mod export;
pub mod goals;
pub mod meta;
pub mod reconciliations;
pub mod reports;
pub mod rules;
pub mod transactions;

pub use accounts::{create_account, delete_account, get_account, get_balance, list_accounts, update_account};
pub use budgets::{
    copy_from_previous_month, get_budgets_for_month, get_rolled_over, get_spent_for_bucket,
    has_allocations, set_allocation,
};
pub use categories::{
    create_bucket, create_tag, delete_bucket, delete_tag, get_tag_transaction_info, list_buckets,
    list_tags, move_tag, rename_bucket, rename_tag, set_rollover_enabled,
};
pub use goals::{
    create_goal, delete_goal, get_goal, list_goals, update_goal,
};
pub use meta::{
    clear_default_quick_account, delete_meta, get_currency, get_default_quick_account,
    get_locale, get_meta, is_first_run_complete, is_tour_complete, set_default_quick_account,
    set_first_run_complete, set_meta, set_tour_complete,
};
pub use rules::{
    create_rule, delete_rule, get_rule, list_all_rules, list_rules, update_rule, upsert_learned,
};
pub use transactions::{
    create_transaction, create_transactions_batch, delete_transaction, duplicate_transaction,
    get_transaction, list_transactions, restore_transaction, update_transaction,
};
