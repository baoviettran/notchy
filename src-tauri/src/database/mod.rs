//! Native database integrity boundary contracts.
//!
//! Task 1 scope: the stable error envelope, common DTO types, and the
//! TypeScript binding generator. Task 2 scope: the dedicated executor thread,
//! lifecycle snapshot, exact connection policy, and authoritative OS lock.
//! Task 14 scope: all domain commands registered with Tauri.

pub mod backup;
pub mod commands;
pub mod connection;
pub mod domains;
pub mod error;
pub mod executor;
pub mod lock;
pub mod manifest;
pub mod migrations;
pub mod receipt;
pub mod restore;
pub mod startup;
pub mod types;

pub use backup::{
    cleanup_interrupted_publications, discover_verified_backups, publish_backup,
    retention_deletions, BackupFailurePoint,
};
pub use restore::{arm_restore_failpoint, clear_restore_failpoint, discover_restore_points, RestoreFailurePoint};
pub use domains::export::{export_transactions_csv, sanitize_csv_cell};
pub use domains::reports::{
    get_category_trend, get_comparison, get_net_worth_series, get_overview,
    get_stacked_category_series, get_trend, get_year_over_year,
};
pub use commands::{database_initialize, database_retry, database_status, generate_bindings};
pub use connection::{open_live, open_read_only, DatabasePaths};
pub use error::{validate_money, DbError, DbResult, ErrorCode, MetaKey};
pub use executor::{DatabaseManager, ExecutorState};
pub use lock::ProcessLock;
pub use manifest::{inspect_schema, validate_manifest, InvalidSchemaReason, SchemaInspection};
pub use migrations::{
    bootstrap_current, migrate_supported, run_migrations, FailurePoint, Migration, MIGRATIONS,
    LATEST_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION,
};
pub use startup::{DatabaseStatus, StartupEvent};
pub use types::{
    validate_bounded_list, validate_bounded_text, Account, AccountPatch, AccountType,
    AccountWithBalance, BackupHealth, BackupHealthOptions, BackupSummary, BackupToken,
    Bucket, BucketSpending, Budget, BudgetSummary,
    CategoryTrendPoint, CategorizeRule, CompareRow, DebtAccount, DebtSummary,
    Goal, GoalStatus, GoalType, GoalWithProgress,
    IsoDate, LifecycleState, MatchMode, NetWorthPoint, NewAccount, NewTransaction,
    OperationId, OverviewReport, Page, Patch, ReconcileResult, Reconciliation,
    RecoveryContext, RuleSource, StackedCategoryPoint, StackedTag, StartupStage, Tag, TagDeleteInfo,
    TagSpending, TopTransaction, Transaction, TransactionFilter, TransactionKind,
    TransactionPatch, TrendPoint, VelocityStatus, YearOverYearPoint,
};
