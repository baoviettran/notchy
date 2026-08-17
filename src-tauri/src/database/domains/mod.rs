//! Domain services for accounts and transactions (Task 7).
//!
//! Every mutation goes through `run_idempotent`; read-only operations query
//! directly. Business rules are ported 1:1 from the TypeScript repositories.

pub mod accounts;
pub mod transactions;

pub use accounts::{create_account, delete_account, get_account, list_accounts, update_account};
pub use transactions::{
    create_transaction, create_transactions_batch, delete_transaction, duplicate_transaction,
    get_transaction, list_transactions, restore_transaction, update_transaction,
};
