//! Common native DTO types: strict newtypes, bounded validators, lifecycle
//! DTOs, and the tagged patch enum.
//!
//! These are the shared contracts later tasks build on. Newtypes validate at
//! construction (`parse`), and the generated TypeScript keeps the raw JSON
//! shape (plain strings / discriminated unions).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::database::error::ErrorCode;

/// Strict ISO-8601 calendar date, `YYYY-MM-DD`, validated against the real
/// calendar (month length and leap years). Serialized as a plain string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(into = "String", try_from = "String")]
pub struct IsoDate(String);

impl IsoDate {
    /// Parse and validate an ISO date string.
    pub fn parse(value: impl Into<String>) -> Result<Self, ErrorCode> {
        let value = value.into();
        if !is_valid_iso_date(&value) {
            return Err(ErrorCode::InvalidDate);
        }
        Ok(IsoDate(value))
    }

    /// The canonical `YYYY-MM-DD` string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for IsoDate {
    type Error = ErrorCode;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        IsoDate::parse(value)
    }
}

impl From<IsoDate> for String {
    fn from(date: IsoDate) -> String {
        date.0
    }
}

/// A validated ULID string identifying an operation or entity.
///
/// Serialized as a plain string; `parse` and the deserializer enforce a valid
/// Crockford base32 ULID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(into = "String", try_from = "String")]
pub struct OperationId(String);

impl OperationId {
    /// Parse and validate a ULID string.
    pub fn parse(value: impl Into<String>) -> Result<Self, ErrorCode> {
        let value = value.into();
        ulid::Ulid::from_string(&value).map_err(|_| ErrorCode::InvalidUlid)?;
        Ok(OperationId(value))
    }

    /// Generate a fresh random ULID.
    pub fn generate() -> Self {
        let ulid = ulid::Generator::new()
            .generate()
            .expect("a fresh ulid generator cannot overflow");
        OperationId(ulid.to_string())
    }

    /// The canonical ULID string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for OperationId {
    type Error = ErrorCode;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        OperationId::parse(value)
    }
}

impl From<OperationId> for String {
    fn from(id: OperationId) -> String {
        id.0
    }
}

impl std::str::FromStr for OperationId {
    type Err = ErrorCode;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        OperationId::parse(s)
    }
}

/// Reject text longer than `max_len` characters (Unicode scalar values).
pub fn validate_bounded_text(value: &str, max_len: usize) -> Result<(), ErrorCode> {
    if value.chars().count() <= max_len {
        Ok(())
    } else {
        Err(ErrorCode::InvalidInput)
    }
}

/// Reject lists longer than `max_len` entries.
pub fn validate_bounded_list(len: usize, max_len: usize) -> Result<(), ErrorCode> {
    if len <= max_len {
        Ok(())
    } else {
        Err(ErrorCode::InvalidInput)
    }
}

/// A patchable field that distinguishes omitted, explicit null, and replacement.
///
/// Tagged union: `{ kind: "omitted" }`, `{ kind: "explicit_null" }`, or
/// `{ kind: "replace", value: T }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Patch<T> {
    /// The field was not supplied; keep the existing value.
    Omitted,
    /// The field was explicitly supplied as null.
    ExplicitNull,
    /// The field has a replacement value.
    Replace { value: T },
}

/// Protected lifecycle state of the native database boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleState {
    Uninitialized,
    Initializing,
    Ready,
    RecoveryRequired,
    Restoring,
}

/// Sub-stage reported while initializing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StartupStage {
    Checking,
    BackingUp,
    Migrating,
    Verifying,
}

/// Safe context returned when the boundary enters `RecoveryRequired`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecoveryContext {
    /// Stable error code that triggered recovery.
    pub code: ErrorCode,
    /// Whether the failure is retryable without a restore.
    pub retryable: bool,
}

/// Common paged result envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub offset: u64,
    pub limit: u64,
}

// ---------------------------------------------------------------------------
// Account DTOs
// ---------------------------------------------------------------------------

/// Account type discriminator — matches the CHECK constraint in the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AccountType {
    Checking,
    Savings,
    Cash,
    CreditCard,
    LoanToPerson,
    LoanFromPerson,
}

impl AccountType {
    /// Asset account types (positive balance = money you have).
    pub fn is_asset(self) -> bool {
        matches!(
            self,
            AccountType::Checking
                | AccountType::Savings
                | AccountType::Cash
                | AccountType::LoanToPerson
        )
    }

    /// Liability account types (positive balance = money you owe).
    pub fn is_liability(self) -> bool {
        matches!(self, AccountType::CreditCard | AccountType::LoanFromPerson)
    }

    /// Loan account types (require a counterparty).
    pub fn is_loan(self) -> bool {
        matches!(self, AccountType::LoanToPerson | AccountType::LoanFromPerson)
    }

    /// Serialise to the SQL string value.
    pub fn as_str(self) -> &'static str {
        match self {
            AccountType::Checking => "checking",
            AccountType::Savings => "savings",
            AccountType::Cash => "cash",
            AccountType::CreditCard => "credit_card",
            AccountType::LoanToPerson => "loan_to_person",
            AccountType::LoanFromPerson => "loan_from_person",
        }
    }
}

/// A persisted account row (without balance).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Account {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub counterparty: Option<String>,
    pub currency: String,
    pub archived: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Account with computed balance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AccountWithBalance {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub counterparty: Option<String>,
    pub currency: String,
    pub archived: i64,
    pub created_at: String,
    pub updated_at: String,
    pub balance: i64,
}

/// Input for creating a new account.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct NewAccount {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub counterparty: Option<String>,
    pub currency: String,
    pub initial_balance: Option<i64>,
    pub initial_balance_date: Option<String>,
}

/// Partial update for an existing account.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AccountPatch {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub account_type: Option<AccountType>,
    pub counterparty: Patch<String>,
    pub archived: Option<i64>,
}

// ---------------------------------------------------------------------------
// Transaction DTOs
// ---------------------------------------------------------------------------

/// Transaction kind discriminator — matches the CHECK constraint in the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TransactionKind {
    Expense,
    Income,
    Transfer,
    Refund,
    Adjustment,
}

impl TransactionKind {
    /// Serialise to the SQL string value.
    pub fn as_str(self) -> &'static str {
        match self {
            TransactionKind::Expense => "expense",
            TransactionKind::Income => "income",
            TransactionKind::Transfer => "transfer",
            TransactionKind::Refund => "refund",
            TransactionKind::Adjustment => "adjustment",
        }
    }
}

/// A persisted transaction row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Transaction {
    pub id: String,
    pub kind: TransactionKind,
    pub date: String,
    pub amount: i64,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    pub transfer_pair_id: Option<String>,
    pub refund_of_id: Option<String>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a new transaction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct NewTransaction {
    pub kind: TransactionKind,
    pub date: String,
    pub amount: i64,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    pub refund_of_id: Option<String>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub description: Option<String>,
}

/// Filter criteria for listing transactions.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct TransactionFilter {
    pub account_id: Option<String>,
    pub kind: Option<TransactionKind>,
    pub tag_id: Option<String>,
    pub payee: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub query: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Partial update for an existing transaction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TransactionPatch {
    pub date: Option<String>,
    pub amount: Option<i64>,
    pub transfer_account_id: Option<String>,
    pub tag_id: Patch<String>,
    pub payee: Patch<String>,
    pub description: Patch<String>,
}

// ---------------------------------------------------------------------------
// Category types
// ---------------------------------------------------------------------------

/// A top-level category group (maps to `category_types` table).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Bucket {
    pub id: String,
    pub name: String,
    pub is_system: i32,
    pub budgetable: i32,
    pub rollover_enabled: i32,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// A category tag within a bucket (maps to `category_tags` table).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Tag {
    pub id: String,
    pub type_id: String,
    pub name: String,
    pub is_system: i32,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// Info about transactions affected by a tag move or delete.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TagDeleteInfo {
    pub affected_count: i64,
    pub affected_total: i64,
}

// ---------------------------------------------------------------------------
// Budget types
// ---------------------------------------------------------------------------

/// A raw budget row (maps to `budgets` table).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Budget {
    pub id: String,
    pub type_id: String,
    pub month: String,
    pub allocated: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Enriched budget with spending and rollover calculations.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BudgetSummary {
    pub type_id: String,
    pub month: String,
    pub allocated: i64,
    pub spent: i64,
    pub remaining: i64,
    pub rolled_over: i64,
    pub available: i64,
}

// ---------------------------------------------------------------------------
// Reconciliation types
// ---------------------------------------------------------------------------

/// A reconciliation audit record (maps to `reconciliations` table).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Reconciliation {
    pub id: String,
    pub account_id: String,
    pub date: String,
    pub expected_balance: i64,
    pub actual_balance: i64,
    pub adjustment_transaction_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of a reconcile operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ReconcileResult {
    pub discrepancy: i64,
    pub reconciliation_id: String,
    pub adjustment_transaction_id: Option<String>,
}

// ---------------------------------------------------------------------------
// Debt types
// ---------------------------------------------------------------------------

/// A debt account with computed balance.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DebtAccount {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub counterparty: String,
    pub balance: i64,
    pub last_activity: Option<String>,
}

/// Summary of debts split by direction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DebtSummary {
    pub i_owe: Vec<DebtAccount>,
    pub owed_to_me: Vec<DebtAccount>,
}

// ---------------------------------------------------------------------------
// Goal types
// ---------------------------------------------------------------------------

/// Goal type discriminator — matches the CHECK constraint in the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GoalType {
    Savings,
    DebtPayoff,
    NetWorth,
}

impl GoalType {
    pub fn as_str(self) -> &'static str {
        match self {
            GoalType::Savings => "savings",
            GoalType::DebtPayoff => "debt_payoff",
            GoalType::NetWorth => "net_worth",
        }
    }
}

/// Goal status discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Completed,
    Abandoned,
    Overdue,
}

impl GoalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            GoalStatus::Active => "active",
            GoalStatus::Completed => "completed",
            GoalStatus::Abandoned => "abandoned",
            GoalStatus::Overdue => "overdue",
        }
    }
}

/// Velocity status for goal progress tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum VelocityStatus {
    InsufficientData,
    Behind,
    OnTrack,
    Ahead,
    Overdue,
}

/// A persisted goal row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Goal {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub goal_type: GoalType,
    pub target_amount: i64,
    pub target_date: String,
    pub linked_account_id: Option<String>,
    pub starting_amount: i64,
    pub show_on_dashboard: i64,
    pub status: GoalStatus,
    pub closed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Goal enriched with progress and velocity calculations.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GoalWithProgress {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub goal_type: GoalType,
    pub target_amount: i64,
    pub target_date: String,
    pub linked_account_id: Option<String>,
    pub starting_amount: i64,
    pub show_on_dashboard: i64,
    pub status: GoalStatus,
    pub closed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub current_amount: i64,
    pub progress_pct: i64,
    pub velocity_status: VelocityStatus,
}

// ---------------------------------------------------------------------------
// Categorize rule types
// ---------------------------------------------------------------------------

/// Match mode for categorize rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum MatchMode {
    Is,
    StartsWith,
    Contains,
}

impl MatchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            MatchMode::Is => "is",
            MatchMode::StartsWith => "starts_with",
            MatchMode::Contains => "contains",
        }
    }
}

/// Rule source discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RuleSource {
    Manual,
    Learned,
}

impl RuleSource {
    pub fn as_str(self) -> &'static str {
        match self {
            RuleSource::Manual => "manual",
            RuleSource::Learned => "learned",
        }
    }
}

/// A persisted categorize rule row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CategorizeRule {
    pub id: String,
    pub payee_term: String,
    pub match_mode: MatchMode,
    pub tag_id: String,
    pub source: RuleSource,
    pub enabled: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// An opaque, in-memory handle to one verified published backup.
///
/// Fields are private: callers interact through accessors, and the path shown
/// is always a canonical approved path. Never exported to TypeScript (Task 7
/// regenerates bindings from later tasks); `BackupToken` is deliberately not
/// serializable so the raw path cannot cross the IPC boundary by accident.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupToken {
    id: OperationId,
    canonical_path: std::path::PathBuf,
    schema: i64,
    fingerprint: String,
}

impl BackupToken {
    /// Construct a token bound to a canonical path, schema, and fingerprint.
    /// `pub(crate)`: only the backup service issues tokens.
    pub(crate) fn new(
        id: OperationId,
        canonical_path: std::path::PathBuf,
        schema: i64,
        fingerprint: String,
    ) -> Self {
        BackupToken {
            id,
            canonical_path,
            schema,
            fingerprint,
        }
    }

    /// The canonical, approved filesystem path of the published backup.
    pub fn path(&self) -> &std::path::Path {
        &self.canonical_path
    }

    /// The source schema version recorded for the published backup.
    pub fn schema(&self) -> i64 {
        self.schema
    }

    /// The validation fingerprint (content hash) of the published backup.
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
}

/// A safe, verified backup record for display and retention.
///
/// Paths shown are canonical approved paths. Contains no raw SQLite strings,
/// no SQL parameters, no monetary values, and no payees. Not exported to
/// TypeScript in this task; the TS bindings are regenerated from Task 7 onward.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupSummary {
    /// Stable identifier: the backup's ULID.
    pub id: String,
    /// Canonical approved filesystem path of the verified backup.
    pub path: String,
    /// Source schema version recorded in the backup.
    pub schema_version: i64,
    /// Source application version recorded in the backup filename.
    pub source_app_version: String,
    /// ISO-8601 creation time derived from the backup's ULID.
    pub created_at: String,
    /// Whether the record passed full revalidation. Always `true` for records
    /// returned by verified discovery.
    pub verified: bool,
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/// Overview report for a single month.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct OverviewReport {
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub spending_by_bucket: Vec<BucketSpending>,
}

/// A bucket's total spending in the overview report.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BucketSpending {
    pub type_id: String,
    pub name: String,
    pub total: i64,
}

/// A single point in a trend series.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TrendPoint {
    pub month: String,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
}

/// A row in the comparison between two months.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CompareRow {
    pub category: String,
    pub month_a: i64,
    pub month_b: i64,
    pub delta: i64,
}

/// A single point in a category trend series.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CategoryTrendPoint {
    pub month: String,
    pub total: i64,
}

/// A single point in a stacked category series.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct StackedCategoryPoint {
    pub month: String,
    pub categories: Vec<TypeTotal>,
}

/// A type_id and total pair for stacked categories.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TypeTotal {
    pub type_id: String,
    pub total: i64,
}

/// A single point in a year-over-year comparison.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct YearOverYearPoint {
    pub month: String,
    pub income: i64,
    pub expense: i64,
}

/// A single point in a net-worth series.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct NetWorthPoint {
    pub month: String,
    pub net_worth: i64,
}

// ---------------------------------------------------------------------------
// Backup health types
// ---------------------------------------------------------------------------

/// Backup health summary for the settings card.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BackupHealth {
    pub last_backup: Option<String>,
    pub backup_count: usize,
    pub backup_dir: String,
    pub db_size: u64,
    pub latest_backup_size: Option<u64>,
}

/// Options for computing backup health.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BackupHealthOptions {
    pub backup_dir: String,
    pub database_path: String,
}

/// Validate a strict `YYYY-MM-DD` calendar date.
fn is_valid_iso_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };

    if year.len() != 4 || !year.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if month.len() != 2 || !month.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    if day.len() != 2 || !day.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let Ok(year) = year.parse::<u32>() else {
        return false;
    };
    let Ok(month) = month.parse::<u32>() else {
        return false;
    };
    let Ok(day) = day.parse::<u32>() else {
        return false;
    };
    if !(1..=12).contains(&month) {
        return false;
    }

    let max_days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap { 29 } else { 28 }
        }
        _ => return false,
    };
    (1..=max_days).contains(&day)
}
