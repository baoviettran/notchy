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
