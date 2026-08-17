//! Native command guard tests (Task 5).
//!
//! Proves the window-label guard is authoritative: only the `main` window may
//! request initialize/retry/status, quick-add is rejected with `InvalidInput`,
//! and every data-job entry point rejects writes while the boundary is not
//! `Ready`.

use std::sync::Arc;

use tauri::Manager;

use notchy_lib::database::commands::{database_initialize, database_retry, database_status};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::executor::DatabaseManager;
use notchy_lib::database::types::{LifecycleState, StartupStage};

mod common;
use common::{
    manager_for_fixture, manager_fresh, mock_app, wait_until_stage, write_as,
};

// ---------------------------------------------------------------------------
// Main-only window guard
// ---------------------------------------------------------------------------

#[tokio::test]
async fn non_main_window_cannot_initialize() {
    let manager = manager_fresh().await;
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = database_initialize(app.quick_add.clone(), state)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
    assert_eq!(
        manager.snapshot(),
        LifecycleState::Uninitialized,
        "a rejected caller must not move the lifecycle"
    );
}

#[tokio::test]
async fn non_main_window_cannot_retry() {
    let manager = manager_fresh().await;
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = database_retry(app.quick_add.clone(), state)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn non_main_window_cannot_query_status() {
    let manager = manager_fresh().await;
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = database_status(app.quick_add.clone(), state)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn main_window_initialize_reaches_ready() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let app = mock_app(Arc::clone(&manager));
    let state = app.app.state::<Arc<DatabaseManager>>();
    let status = database_initialize(app.main.clone(), state).await.unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);
    assert_eq!(manager.snapshot(), LifecycleState::Ready);
}

#[tokio::test]
async fn main_window_retry_and_status_pass_guard() {
    let manager = manager_for_fixture("v007.sqlite").await;
    let app = mock_app(Arc::clone(&manager));

    // Initialize is permitted from main and lands in RecoveryRequired.
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = database_initialize(app.main.clone(), state)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::SchemaTooNew);
    assert_eq!(manager.snapshot(), LifecycleState::RecoveryRequired);

    // Status from main returns the recovery status.
    let state = app.app.state::<Arc<DatabaseManager>>();
    let status = database_status(app.main.clone(), state).await.unwrap();
    assert_eq!(status.lifecycle, LifecycleState::RecoveryRequired);
    assert_eq!(status.recovery.as_ref().unwrap().code, ErrorCode::SchemaTooNew);

    // Retry from main re-runs the startup and re-enters RecoveryRequired.
    let state = app.app.state::<Arc<DatabaseManager>>();
    let error = database_retry(app.main.clone(), state).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::SchemaTooNew);
}

// ---------------------------------------------------------------------------
// Data-job lifecycle guard
// ---------------------------------------------------------------------------

#[tokio::test]
async fn data_jobs_reject_when_not_ready() {
    // Uninitialized: the boundary must be initialized before any write.
    let manager = manager_fresh().await;
    let error = write_as("main", &manager).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::DatabaseUpdateRequired);

    // Initializing (mid-migration): writes are rejected with update-required.
    let manager = manager_for_fixture("v004.sqlite").await;
    let release = manager.arm_migration_pause();
    let spawned = Arc::clone(&manager);
    let _handle = tokio::spawn(async move {
        let _ = spawned.initialize().await;
    });
    wait_until_stage(&manager, StartupStage::Migrating).await;
    let error = write_as("quick-add", &manager).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::DatabaseUpdateRequired);
    let _ = release.send(());

    // RecoveryRequired: writes are rejected with recovery-required.
    let manager = manager_for_fixture("v007.sqlite").await;
    let _ = manager.initialize().await;
    let error = write_as("main", &manager).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::RecoveryRequired);
}

#[tokio::test]
async fn data_jobs_run_once_ready() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let _ = manager.initialize().await.unwrap();
    assert_eq!(manager.snapshot(), LifecycleState::Ready);
    // Once ready, a data job reaches the executor and can read the live
    // connection.
    let version: i64 = manager
        .data_job(|state| {
            let value: String = state
                .connection()?
                .query_row(
                    "SELECT value FROM app_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    notchy_lib::database::error::DbError::new(ErrorCode::DatabaseCorrupt)
                })?;
            Ok(value.parse().unwrap_or(0))
        })
        .await
        .unwrap();
    assert_eq!(version, 6);
}
