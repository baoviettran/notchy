//! Stable, allowlisted native error envelope.
//!
//! Contract: `DbError { code: ErrorCode, meta: BTreeMap<String, String> }`.
//! Meta keys are an enum-backed allowlist; arbitrary keys are rejected at the
//! builder, and no raw SQLite text, SQL parameters, rows, payees, or monetary
//! values ever enter errors.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable error codes for the native database boundary.
///
/// Serialized as `snake_case`. This is a fixed allowlist, not a catch-all:
/// variants never carry data.
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    DatabaseBusy,
    DatabaseLocked,
    DatabaseNotReady,
    DatabaseUpdateRequired,
    UnauthorizedCaller,
    SchemaTooOld,
    SchemaTooNew,
    DatabaseInvalid,
    DatabaseCorrupt,
    BackupUnavailable,
    RestoreFailed,
    OperationIdConflict,
    AmountOutOfRange,
    InvalidUlid,
    InvalidDate,
    InvalidInput,
    RecoveryRequired,
}

impl ErrorCode {
    /// Stable snake_case identifier, matching the serialized form.
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::DatabaseBusy => "database_busy",
            ErrorCode::DatabaseLocked => "database_locked",
            ErrorCode::DatabaseNotReady => "database_not_ready",
            ErrorCode::DatabaseUpdateRequired => "database_update_required",
            ErrorCode::UnauthorizedCaller => "unauthorized_caller",
            ErrorCode::SchemaTooOld => "schema_too_old",
            ErrorCode::SchemaTooNew => "schema_too_new",
            ErrorCode::DatabaseInvalid => "database_invalid",
            ErrorCode::DatabaseCorrupt => "database_corrupt",
            ErrorCode::BackupUnavailable => "backup_unavailable",
            ErrorCode::RestoreFailed => "restore_failed",
            ErrorCode::OperationIdConflict => "operation_id_conflict",
            ErrorCode::AmountOutOfRange => "amount_out_of_range",
            ErrorCode::InvalidUlid => "invalid_ulid",
            ErrorCode::InvalidDate => "invalid_date",
            ErrorCode::InvalidInput => "invalid_input",
            ErrorCode::RecoveryRequired => "recovery_required",
        }
    }
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::error::Error for ErrorCode {}

/// Allowlisted error-metadata keys.
///
/// Only these keys may appear in [`DbError::meta`]. Values are safe,
/// programmer-supplied strings (for example a lifecycle stage, a schema
/// version, or a retryability flag) — never raw strings from SQLite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum MetaKey {
    /// Lifecycle stage during which the error occurred, e.g. `"migrating"`.
    Stage,
    /// Source or target schema version, e.g. `"3"` or `"6"`.
    SchemaVersion,
    /// Whether the operation can be retried as-is: `"true"` or `"false"`.
    Retryable,
}

impl MetaKey {
    /// The stable serialized key name.
    pub const fn as_str(self) -> &'static str {
        match self {
            MetaKey::Stage => "stage",
            MetaKey::SchemaVersion => "schema_version",
            MetaKey::Retryable => "retryable",
        }
    }

    /// Resolve a string to an allowlisted key, or `None` for unknown keys.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "stage" => Some(MetaKey::Stage),
            "schema_version" => Some(MetaKey::SchemaVersion),
            "retryable" => Some(MetaKey::Retryable),
            _ => None,
        }
    }
}

/// Stable native error envelope.
///
/// Serialized shape: `{ "code": "...", "meta": { ... } }`. Meta keys are
/// restricted to [`MetaKey`]; the builder enforces the allowlist, and an
/// unknown key is a programming error.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DbError {
    pub code: ErrorCode,
    pub meta: BTreeMap<String, String>,
}

impl DbError {
    /// Create an empty envelope for a stable error code.
    pub const fn new(code: ErrorCode) -> Self {
        DbError {
            code,
            meta: BTreeMap::new(),
        }
    }

    /// Attach an allowlisted metadata entry.
    ///
    /// Panics if `key` is not a known [`MetaKey`]; callers always pass literal
    /// keys, so an unknown key is a programming error.
    #[track_caller]
    pub fn with_meta(mut self, key: &str, value: impl Into<String>) -> Self {
        let key = MetaKey::from_str(key).unwrap_or_else(|| {
            panic!("unknown metadata key: {key}");
        });
        self.meta.insert(key.as_str().to_string(), value.into());
        self
    }
}

impl From<ErrorCode> for DbError {
    fn from(code: ErrorCode) -> Self {
        DbError::new(code)
    }
}

/// Result alias used across the native database boundary.
pub type DbResult<T> = Result<T, DbError>;

/// Reject monetary values outside JavaScript's safe integer range.
pub fn validate_money(value: i64) -> Result<i64, ErrorCode> {
    const JS_MAX_SAFE: u64 = 9_007_199_254_740_991;
    (value.unsigned_abs() <= JS_MAX_SAFE).then_some(value).ok_or(ErrorCode::AmountOutOfRange)
}
