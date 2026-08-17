//! Idempotent mutation harness (Task 6).
//!
//! `run_idempotent` ensures every database mutation is applied exactly once
//! even under retries or lost responses, using the `operation_receipts` table.

use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde::{Serialize, de::DeserializeOwned};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::types::OperationId;

/// Canonicalize a request DTO to a deterministic JSON string.
///
/// Round-trips through `serde_json::Value` to guarantee stable key ordering,
/// then serializes with `serde_json::to_string` on the sorted value.
fn canonicalize_request<Req: Serialize>(request: &Req) -> DbResult<String> {
    let value = serde_json::to_value(request).map_err(|_| DbError::new(ErrorCode::DatabaseCorrupt))?;
    serde_json::to_string(&value).map_err(|_| DbError::new(ErrorCode::DatabaseCorrupt))
}

/// Hash `command_kind || canonical_json` with BLAKE3, return the raw 32-byte digest.
fn hash_request(command_kind: &str, canonical_json: &str) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(command_kind.as_bytes());
    hasher.update(canonical_json.as_bytes());
    *hasher.finalize().as_bytes()
}

/// Encode raw bytes as a lowercase hex string for TEXT column storage.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Run a database mutation idempotently.
///
/// On first call: executes `operation` inside a `BEGIN IMMEDIATE` transaction,
/// stores the receipt, and commits.
/// On retry with same `operation_id` + same request: returns the cached result
/// without re-running the closure.
/// On retry with same `operation_id` + different request: returns
/// `OperationIdConflict`.
pub fn run_idempotent<Req, Res, F>(
    connection: &mut Connection,
    operation_id: OperationId,
    command_kind: &'static str,
    request: &Req,
    operation: F,
) -> DbResult<Res>
where
    Req: Serialize,
    Res: Serialize + DeserializeOwned,
    F: FnOnce(&Transaction<'_>) -> DbResult<Res>,
{
    let canonical_json = canonicalize_request(request)?;
    let request_hash = hash_request(command_kind, &canonical_json);
    let request_hash_hex = hex_encode(&request_hash);
    let op_id_str = operation_id.as_str();

    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(map_sqlite_error)?;

    // Look up existing receipt.
    let lookup_result = tx.query_row(
        "SELECT command_kind, request_hash FROM operation_receipts WHERE operation_id = ?1",
        params![op_id_str],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    );

    match lookup_result {
        Ok((existing_kind, existing_hash)) => {
            // Receipt exists — verify command_kind matches.
            if existing_kind != command_kind {
                tx.rollback().map_err(map_sqlite_error)?;
                return Err(DbError::new(ErrorCode::OperationIdConflict));
            }
            // Verify hash matches.
            if existing_hash != request_hash_hex {
                tx.rollback().map_err(map_sqlite_error)?;
                return Err(DbError::new(ErrorCode::OperationIdConflict));
            }
            // Same hash — return the cached result.
            let result_json: String = tx
                .query_row(
                    "SELECT result_json FROM operation_receipts WHERE operation_id = ?1",
                    params![op_id_str],
                    |row| row.get(0),
                )
                .map_err(map_sqlite_error)?;
            let result: Res = serde_json::from_str(&result_json)
                .map_err(|_| DbError::new(ErrorCode::DatabaseCorrupt))?;
            tx.commit().map_err(map_sqlite_error)?;
            Ok(result)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            // No receipt — run the business closure.
            let result = operation(&tx)?;
            let result_json = serde_json::to_string(&result)
                .map_err(|_| DbError::new(ErrorCode::DatabaseCorrupt))?;
            let completed_at = now_iso8601();

            // Insert the receipt.
            tx.execute(
                "INSERT INTO operation_receipts \
                 (operation_id, command_kind, request_hash, result_json, completed_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![op_id_str, command_kind, request_hash_hex, result_json, completed_at],
            )
            .map_err(map_sqlite_error)?;

            tx.commit().map_err(map_sqlite_error)?;
            Ok(result)
        }
        Err(other) => {
            tx.rollback().map_err(map_sqlite_error)?;
            Err(map_sqlite_error(other))
        }
    }
}

/// Current time as ISO-8601 UTC string (YYYY-MM-DDTHH:MM:SSZ).
fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time must be after UNIX epoch");
    let secs = now.as_secs();
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Civil date from days since epoch (algorithm from Howard Hinnant).
    let z = days as i64 + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    format!(
        "{yr:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}Z"
    )
}
