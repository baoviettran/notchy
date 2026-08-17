//! Domain services for accounts, transactions, categories, and budgets.
//!
//! Every mutation goes through `run_idempotent`; read-only operations query
//! directly. Business rules are ported 1:1 from the TypeScript repositories.

pub mod accounts;
pub mod budgets;
pub mod categories;
pub mod debts;
pub mod reconciliations;
pub mod transactions;

pub use accounts::{create_account, delete_account, get_account, list_accounts, update_account};
pub use budgets::{
    copy_from_previous_month, get_budgets_for_month, has_allocations, set_allocation,
};
pub use categories::{
    create_bucket, create_tag, delete_bucket, delete_tag, get_tag_transaction_info, list_buckets,
    list_tags, move_tag, rename_bucket, rename_tag, set_rollover_enabled,
};
pub use transactions::{
    create_transaction, create_transactions_batch, delete_transaction, duplicate_transaction,
    get_transaction, list_transactions, restore_transaction, update_transaction,
};
