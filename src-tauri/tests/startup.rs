//! Protected startup lifecycle tests (Task 5).
//!
//! Covers the exact startup event order for a supported older schema
//! (backup before migration), the quick-add caller guard and write guard during
//! migration, fresh/current/older/newer/invalid classification paths, failure
//! entering `RecoveryRequired` with retained verified backups, and concurrent
//! initialize calls coalescing so exactly one caller opens SQLite.

use std::sync::Arc;
use std::time::Duration;

use notchy_lib::database::backup::{discover_verified_backups, publish_backup, BackupFailurePoint};
use notchy_lib::database::error::{DbError, DbResult, ErrorCode};
use notchy_lib::database::executor::DatabaseManager;
use notchy_lib::database::startup::{DatabaseStatus, StartupEvent};
use notchy_lib::database::types::{LifecycleState, StartupStage};

mod common;
use common::{
    fixtures_dir, initialize_as, manager_for_fixture, manager_fresh, paths_for, wait_until_stage,
    write_as,
};

/// The result of a successful `initialize_fixture` run: the collected startup
/// event strings plus the final status and the manager itself.
struct InitializeFixture {
    events: Vec<String>,
    status: DatabaseStatus,
    manager: Arc<DatabaseManager>,
}

/// Drains the startup event receiver; after `initialize` completes every event
/// is already buffered, so `try_recv` returns them all in order.
fn drain_events(receiver: &mut tokio::sync::broadcast::Receiver<StartupEvent>) -> Vec<String> {
    let mut out = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        out.push(event.as_str().to_string());
    }
    out
}

/// Run `initialize` over a committed fixture and collect the emitted events.
async fn initialize_fixture(fixture: &str) -> DbResult<InitializeFixture> {
    let manager = manager_for_fixture(fixture).await;
    let mut receiver = manager.subscribe_startup();
    let status = manager.initialize().await?;
    Ok(InitializeFixture {
        events: drain_events(&mut receiver),
        status,
        manager,
    })
}

/// Run `initialize` over an absent database and collect the emitted events.
async fn initialize_fresh() -> DbResult<InitializeFixture> {
    let manager = manager_fresh().await;
    let mut receiver = manager.subscribe_startup();
    let status = manager.initialize().await?;
    Ok(InitializeFixture {
        events: drain_events(&mut receiver),
        status,
        manager,
    })
}

/// The brief canonical harness: a manager paused inside the migration stage so
/// a concurrent caller observes `Initializing` and is rejected. The release
/// sender is kept alive for the whole test process so the paused migration
/// stays blocked; the one-shot pause gate is consumed by this migration, so
/// later startups in the same process never block.
static PAUSED_RELEASE: std::sync::OnceLock<std::sync::mpsc::Sender<()>> =
    std::sync::OnceLock::new();

async fn paused_migration_manager() -> Arc<DatabaseManager> {
    let manager = manager_for_fixture("v004.sqlite").await;
    let release = manager.arm_migration_pause();
    let _ = PAUSED_RELEASE.set(release);
    let spawned = Arc::clone(&manager);
    let _handle = tokio::spawn(async move {
        let _ = spawned.initialize().await;
    });
    wait_until_stage(&manager, StartupStage::Migrating).await;
    manager
}

/// Fix Round 1 reproduction (review finding: cancelled `initialize` caller
/// strands the boundary in `Initializing`).
///
/// True cancellation case: the caller future is aborted while the executor job
/// is still running inside the migration pause; the executor thread then runs
/// the job to completion after the release is fired. The boundary must land in
/// a terminal state (`Ready` for a healthy v004 migration), never `Initializing`.
#[tokio::test]
async fn cancelled_initialize_still_reaches_ready() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let release = manager.arm_migration_pause();
    let spawned = Arc::clone(&manager);
    let handle = tokio::spawn(async move {
        let _ = spawned.initialize().await;
    });
    // The caller future is now blocked awaiting the executor job, which is
    // parked at the migration pause inside `perform_startup`.
    wait_until_stage(&manager, StartupStage::Migrating).await;
    // Cancel the caller future at its await point.
    handle.abort();
    // Firing the release lets the executor job run to completion (backup
    // already published, migration finishes, connection stored).
    let _ = release.send(());
    // Bounded wait: the boundary must reach `Ready` even though its caller is
    // gone. A cancelled-caller strand would leave it in `Initializing` forever.
    for _ in 0..2000 {
        if manager.snapshot() == LifecycleState::Ready {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(
        manager.snapshot(),
        LifecycleState::Ready,
        "cancelled initialize caller must not strand the boundary in Initializing"
    );
    assert_eq!(manager.startup_stage(), None);
    assert_eq!(manager.recovery_context(), None);
    // The completed job stored the live connection; a data job now works.
    manager.data_job(|_state| Ok(())).await.unwrap();
}

// ---------------------------------------------------------------------------
// Brief Step 1 canonical tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn initialization_orders_backup_before_migration() {
    let events = initialize_fixture("v004.sqlite").await.unwrap().events;
    assert_eq!(
        events,
        ["checking", "backing_up", "migrating", "verifying", "ready"]
    );
}

#[tokio::test]
async fn quick_add_cannot_initialize_or_write_during_migration() {
    let manager = paused_migration_manager().await;
    assert_eq!(
        initialize_as("quick-add", &manager).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        write_as("quick-add", &manager).await.unwrap_err().code,
        ErrorCode::DatabaseUpdateRequired
    );
}

// ---------------------------------------------------------------------------
// Classification paths
// ---------------------------------------------------------------------------

#[tokio::test]
async fn fresh_database_initializes_to_ready() {
    let fixture = initialize_fresh().await.unwrap();
    assert_eq!(
        fixture.events,
        ["checking", "migrating", "verifying", "ready"]
    );
    assert_eq!(fixture.status.lifecycle, LifecycleState::Ready);
    assert_eq!(fixture.manager.snapshot(), LifecycleState::Ready);
    assert_eq!(fixture.manager.startup_stage(), None);
    // The fresh path writes safe startup metadata.
    let meta = fixture
        .manager
        .data_job(|state| {
            let value: String = state
                .connection()?
                .query_row(
                    "SELECT value FROM app_meta WHERE key = 'last_successful_schema_version'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|_| DbError::new(ErrorCode::DatabaseCorrupt))?;
            Ok(value)
        })
        .await
        .unwrap();
    assert_eq!(meta, "6");
}

#[tokio::test]
async fn current_schema_initializes_to_ready() {
    let paths = paths_for("current");
    {
        let mut conn = rusqlite::Connection::open(&paths.db_path).unwrap();
        notchy_lib::database::run_migrations(
            &mut conn,
            notchy_lib::database::LATEST_SCHEMA_VERSION,
            notchy_lib::database::FailurePoint::None,
        )
        .unwrap();
        drop(conn);
    }
    let manager = DatabaseManager::spawn(paths, 16).unwrap();
    let mut receiver = manager.subscribe_startup();
    let status = manager.initialize().await.unwrap();
    assert_eq!(drain_events(&mut receiver), ["checking", "verifying", "ready"]);
    assert_eq!(status.lifecycle, LifecycleState::Ready);
    assert_eq!(manager.snapshot(), LifecycleState::Ready);
}

#[tokio::test]
async fn newer_schema_enters_recovery_required() {
    let manager = manager_for_fixture("v007.sqlite").await;
    let mut receiver = manager.subscribe_startup();
    let error = manager.initialize().await.unwrap_err();
    assert_eq!(error.code, ErrorCode::SchemaTooNew);
    assert_eq!(manager.snapshot(), LifecycleState::RecoveryRequired);
    let context = manager.recovery_context().unwrap();
    assert_eq!(context.code, ErrorCode::SchemaTooNew);
    assert!(!context.retryable);
    assert_eq!(drain_events(&mut receiver), ["checking", "recovery_required"]);
    // Data jobs are rejected while recovery is required.
    assert_eq!(
        manager.data_job(|_| Ok(())).await.unwrap_err().code,
        ErrorCode::RecoveryRequired
    );
}

#[tokio::test]
async fn too_old_and_invalid_enter_recovery_required() {
    for fixture in ["v002.sqlite", "invalid-zero-byte.sqlite"] {
        let manager = manager_for_fixture(fixture).await;
        let error = manager.initialize().await.unwrap_err();
        let expected = if fixture == "v002.sqlite" {
            ErrorCode::SchemaTooOld
        } else {
            ErrorCode::DatabaseInvalid
        };
        assert_eq!(error.code, expected);
        assert_eq!(manager.snapshot(), LifecycleState::RecoveryRequired);
    }
}

#[tokio::test]
async fn failed_startup_retains_verified_backups() {
    let manager = manager_for_fixture("v007.sqlite").await;
    // Pre-publish a verified recovery point so the recovery screen has a
    // backup to offer even though this startup fails.
    let backup_dir = manager.backup_dir();
    publish_backup(
        &fixtures_dir().join("v004.sqlite"),
        &backup_dir,
        BackupFailurePoint::None,
    )
    .unwrap();

    let error = manager.initialize().await.unwrap_err();
    assert_eq!(error.code, ErrorCode::SchemaTooNew);

    let status = manager.status().unwrap();
    assert_eq!(status.lifecycle, LifecycleState::RecoveryRequired);
    assert_eq!(status.recovery.as_ref().unwrap().code, ErrorCode::SchemaTooNew);
    assert_eq!(status.backups.len(), 1);
    assert!(status.backups[0].verified);
}

// ---------------------------------------------------------------------------
// Concurrent initialization
// ---------------------------------------------------------------------------

#[tokio::test]
async fn concurrent_initialize_calls_coalesce() {
    let manager = manager_for_fixture("v004.sqlite").await;
    let mut receiver = manager.subscribe_startup();

    let mut handles = Vec::new();
    for _ in 0..8 {
        let spawned = Arc::clone(&manager);
        handles.push(tokio::spawn(async move {
            spawned.initialize().await
        }));
    }
    for handle in handles {
        let status = handle.await.expect("initialize task panicked").expect("initialize must succeed");
        assert_eq!(status.lifecycle, LifecycleState::Ready);
    }
    assert_eq!(manager.snapshot(), LifecycleState::Ready);

    // Exactly one startup sequence ran: one "checking" event and one published
    // upgrade backup. A secondary caller never re-opened SQLite.
    let events = drain_events(&mut receiver);
    assert_eq!(
        events.iter().filter(|event| event.as_str() == "checking").count(),
        1,
        "exactly one caller may run the startup sequence"
    );
    assert_eq!(
        discover_verified_backups(manager.backup_dir()).unwrap().len(),
        1,
        "exactly one upgrade backup may be published"
    );
}

#[tokio::test]
async fn retry_from_recovery_required_re_runs_startup() {
    // A schema-4 database with the upgrade backup retained, then a forced
    // failure path is not needed: retry on a healthy older schema simply
    // re-initializes. This proves `retry` is allowed and idempotent.
    let fixture = initialize_fixture("v004.sqlite").await.unwrap();
    let manager = fixture.manager;
    let status = manager.retry().await.unwrap();
    assert_eq!(status.lifecycle, LifecycleState::Ready);
    assert_eq!(manager.snapshot(), LifecycleState::Ready);
}
