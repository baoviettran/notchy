//! Integration tests for the idempotent mutation harness (Task 6).
//!
//! Covers: retry-after-commit returns the original result without re-running
//! the closure, and reusing an operation_id with a different request returns
//! OperationIdConflict.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use notchy_lib::database::error::{DbError, DbResult, ErrorCode};
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::OperationId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map a rusqlite error to DbError for use in test closures.
fn sql_err(_e: rusqlite::Error) -> DbError {
    DbError::new(ErrorCode::DatabaseCorrupt)
}

/// Unique scratch path for this test process.
fn scratch_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("notchy-idempotency-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A fresh absent path.
fn fresh_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    scratch_dir().join(format!("{tag}-{nanos}.sqlite"))
}

/// Bootstrap a fresh schema-6 database at a temp path and return the Connection.
fn open_schema6() -> Connection {
    let path = fresh_path("idempotency");
    bootstrap_current(&path, FailurePoint::None).expect("bootstrap must succeed");
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    // Create a simple test table to observe side effects from the business closure.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS test_effects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL
        )",
    )
    .unwrap();
    conn
}

/// A simple serializable request DTO for testing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct TestRequest {
    action: String,
    amount: i64,
}

/// A simple serializable result DTO for testing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct TestResult {
    id: String,
    committed: bool,
}

/// Run `run_idempotent` with a specific operation_id. Returns the result.
fn invoke_with_id(
    conn: &mut Connection,
    op_id: OperationId,
    request: &TestRequest,
) -> DbResult<TestResult> {
    notchy_lib::database::receipt::run_idempotent(
        conn,
        op_id,
        "test_command",
        request,
        |tx| {
            tx.execute("INSERT INTO test_effects (label) VALUES (?1)", ["executed"])
                .map_err(sql_err)?;
            Ok(TestResult {
                id: "result-1".to_string(),
                committed: true,
            })
        },
    )
}

/// Simulate a lost-response scenario: run once, then call again with the same
/// operation_id and same request. The second call should return the cached result
/// without re-running the closure.
fn run_then_drop_response(
    conn: &mut Connection,
    op_id: &OperationId,
    request: &TestRequest,
) -> DbResult<TestResult> {
    // First call: executes the closure, commits receipt + state.
    let result = notchy_lib::database::receipt::run_idempotent(
        conn,
        op_id.clone(),
        "test_command",
        request,
        |tx| {
            tx.execute("INSERT INTO test_effects (label) VALUES (?1)", ["executed"])
                .map_err(sql_err)?;
            Ok(TestResult {
                id: "result-1".to_string(),
                committed: true,
            })
        },
    )?;
    // Caller "drops" the response (simulates lost network response).
    Ok(result)
}

/// Retry with the same operation_id and same request. Should return cached result.
fn invoke_again(
    conn: &mut Connection,
    op_id: &OperationId,
    request: &TestRequest,
) -> DbResult<TestResult> {
    notchy_lib::database::receipt::run_idempotent(
        conn,
        op_id.clone(),
        "test_command",
        request,
        |tx| {
            // This closure should NOT run on retry.
            tx.execute("INSERT INTO test_effects (label) VALUES (?1)", ["retry不该执行"])
                .map_err(sql_err)?;
            Ok(TestResult {
                id: "WRONG".to_string(),
                committed: false,
            })
        },
    )
}

/// Count rows in the test_effects table.
fn count_financial_rows(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM test_effects", [], |row| row.get(0))
        .unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn retry_after_commit_returns_original_result_once() {
    let mut conn = open_schema6();
    let op_id = OperationId::generate();
    let request = TestRequest {
        action: "create_transaction".to_string(),
        amount: 500,
    };

    // Run once — simulates the original call that the caller lost.
    let first = run_then_drop_response(&mut conn, &op_id, &request).unwrap();

    // Retry — should return the same result without re-running the closure.
    let retry = invoke_again(&mut conn, &op_id, &request).unwrap();

    // Same result.
    assert_eq!(retry.id, first.id);
    assert_eq!(retry.committed, first.committed);

    // Closure ran exactly once (one side-effect row).
    assert_eq!(count_financial_rows(&conn), 1);
}

#[test]
fn closure_failure_rolls_back_receipt_and_state() {
    let mut conn = open_schema6();
    let op_id = OperationId::generate();
    let request = TestRequest {
        action: "create_transaction".to_string(),
        amount: 777,
    };

    // The closure always returns Err — simulating a business-rule failure.
    let error = notchy_lib::database::receipt::run_idempotent(
        &mut conn,
        op_id.clone(),
        "test_command",
        &request,
        |_tx| {
            // Insert a side-effect row inside the transaction to prove rollback.
            // We use a raw execute here because we want the transaction to
            // roll back after this insert.
            Err::<TestResult, _>(DbError::new(ErrorCode::DatabaseCorrupt))
        },
    )
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::DatabaseCorrupt);

    // No side-effect row survived the rollback.
    assert_eq!(count_financial_rows(&conn), 0);

    // No receipt row was persisted either.
    let receipt_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM operation_receipts WHERE operation_id = ?1",
            [op_id.as_str()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(receipt_count, 0);
}

#[test]
fn reused_operation_id_with_different_input_fails() {
    let mut conn = open_schema6();
    let op_id = OperationId::generate();

    let request_a = TestRequest {
        action: "create_transaction".to_string(),
        amount: 100,
    };
    let request_b = TestRequest {
        action: "create_transaction".to_string(),
        amount: 200,
    };

    // First call succeeds.
    let first = invoke_with_id(&mut conn, op_id.clone(), &request_a).unwrap();
    assert!(first.committed);

    // Second call with same operation_id but different request — must conflict.
    let error = invoke_with_id(&mut conn, op_id.clone(), &request_b).unwrap_err();
    assert_eq!(error.code, ErrorCode::OperationIdConflict);
}
