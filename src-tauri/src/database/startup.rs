//! Protected startup lifecycle state machine (Task 5).
//!
//! `DatabaseManager::initialize` moves the boundary Uninitialized →
//! Initializing(checking|backing_up|migrating|verifying) → Ready, or into
//! `RecoveryRequired` on any failure. The process lock is already held for the
//! manager lifetime by `spawn`, so inspection strictly follows lock acquisition
//! and no secondary caller can open SQLite: concurrent initialize calls
//! coalesce on an internal mutex and only the first runs the sequence.
//!
//! The whole sequence runs as one executor job so the single live connection is
//! opened, migrated, validated, and stored on the one executor thread. Startup
//! events are broadcast for the progress UI, and the final status retains the
//! recovery context plus verified backup summaries.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::database::backup::{
    cleanup_interrupted_publications, discover_verified_backups, publish_backup,
    BackupFailurePoint,
};
use crate::database::connection::open_live;
use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::executor::{DatabaseManager, ExecutorState};
use crate::database::manifest::{inspect_schema, validate_manifest, SchemaInspection};
use crate::database::migrations::{
    bootstrap_current, run_migrations, FailurePoint, LATEST_SCHEMA_VERSION, now_iso_utc,
};
use crate::database::types::{BackupSummary, LifecycleState, RecoveryContext, StartupStage};

/// Startup progress events emitted while initializing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupEvent {
    Checking,
    BackingUp,
    Migrating,
    Verifying,
    Ready,
    RecoveryRequired {
        context: RecoveryContext,
        backups: Vec<BackupSummary>,
    },
}

impl StartupEvent {
    /// The stable snake_case stage name, matching the frontend progress labels.
    pub fn as_str(&self) -> &'static str {
        match self {
            StartupEvent::Checking => "checking",
            StartupEvent::BackingUp => "backing_up",
            StartupEvent::Migrating => "migrating",
            StartupEvent::Verifying => "verifying",
            StartupEvent::Ready => "ready",
            StartupEvent::RecoveryRequired { .. } => "recovery_required",
        }
    }
}

/// Safe status of the native database boundary, returned by
/// `DatabaseManager::status` and the `database_status` command.
///
/// Contains no raw SQLite text, no SQL parameters, no rows, payees,
/// descriptions, or monetary values; backup paths are canonical approved paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatabaseStatus {
    pub lifecycle: LifecycleState,
    pub stage: Option<StartupStage>,
    pub recovery: Option<RecoveryContext>,
    pub backups: Vec<BackupSummary>,
}

impl DatabaseManager {
    /// Initialize the database boundary and enter `Ready`.
    ///
    /// Coalesces concurrent callers: the first performs the startup sequence;
    /// every subsequent caller waits for it and then observes the resulting
    /// state, so no secondary caller ever opens SQLite.
    pub async fn initialize(self: &Arc<Self>) -> DbResult<DatabaseStatus> {
        let _guard = self.startup_lock.lock().await;
        match self.snapshot() {
            LifecycleState::Ready => return self.status(),
            LifecycleState::Uninitialized | LifecycleState::RecoveryRequired => {}
            LifecycleState::Initializing => return Err(DbError::new(ErrorCode::DatabaseBusy)),
            LifecycleState::Restoring => return Err(DbError::new(ErrorCode::RecoveryRequired)),
        }
        self.run_initialize().await
    }

    /// Retry a failed startup. Allowed from `RecoveryRequired`; re-runs the
    /// same sequence as `initialize`.
    pub async fn retry(self: &Arc<Self>) -> DbResult<DatabaseStatus> {
        self.initialize().await
    }

    /// The current safe status, including lifecycle, active stage, recovery
    /// context, and retained verified backups.
    pub fn status(&self) -> DbResult<DatabaseStatus> {
        Ok(DatabaseStatus {
            lifecycle: self.snapshot(),
            stage: self.startup_stage(),
            recovery: self.recovery_context(),
            backups: discover_verified_backups(self.backup_dir()).unwrap_or_default(),
        })
    }

    async fn run_initialize(self: &Arc<Self>) -> DbResult<DatabaseStatus> {
        self.set_lifecycle(LifecycleState::Initializing);
        self.set_startup_stage(Some(StartupStage::Checking));
        self.set_recovery(None);
        self.emit_startup_event(StartupEvent::Checking);

        // The terminal-state transition runs INSIDE the executor job so a
        // cancelled (`drop`ped/`abort`ed) caller cannot strand the boundary in
        // `Initializing`: the executor thread always finishes the job and moves
        // the boundary to `Ready` or `RecoveryRequired` regardless of whether
        // the response oneshot still has a receiver. All state-mutation helpers
        // are `&self` RwLock writes, safe on the executor thread.
        let manager = Arc::clone(self);
        let result = self
            .call(move |state| {
                match manager.perform_startup(state) {
                    Ok(()) => {
                        manager.set_lifecycle(LifecycleState::Ready);
                        manager.set_startup_stage(None);
                        manager.emit_startup_event(StartupEvent::Ready);
                        manager.status()
                    }
                    Err(error) => {
                        let context = RecoveryContext {
                            code: error.code.clone(),
                            retryable: is_retryable(error.code.clone()),
                        };
                        manager.set_lifecycle(LifecycleState::RecoveryRequired);
                        manager.set_startup_stage(None);
                        manager.set_recovery(Some(context.clone()));
                        let backups =
                            discover_verified_backups(manager.backup_dir()).unwrap_or_default();
                        manager.emit_startup_event(StartupEvent::RecoveryRequired {
                            context,
                            backups: backups.clone(),
                        });
                        Err(error)
                    }
                }
            })
            .await;

        result
    }

    /// The full startup sequence, executed on the executor thread.
    ///
    /// The process lock is already held (acquired by `spawn` before any job
    /// runs), so read-only classification happens strictly after lock
    /// acquisition. Supported older schemas are backed up before the live
    /// connection opens, migrated to schema 6, validated, stamped with safe
    /// startup metadata, and stored as the single live connection.
    fn perform_startup(&self, state: &mut ExecutorState) -> DbResult<()> {
        let paths = self.paths();
        match inspect_schema(&paths.db_path) {
            SchemaInspection::Fresh => {
                self.set_startup_stage(Some(StartupStage::Migrating));
                self.emit_startup_event(StartupEvent::Migrating);
                bootstrap_current(&paths.db_path, FailurePoint::None)?;
                self.set_startup_stage(Some(StartupStage::Verifying));
                self.emit_startup_event(StartupEvent::Verifying);
                let connection = open_live(paths)?;
                validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;
                write_startup_metadata(&connection, None, None)?;
                state.store_connection(connection)?;
                Ok(())
            }
            SchemaInspection::Current { .. } => {
                self.set_startup_stage(Some(StartupStage::Verifying));
                self.emit_startup_event(StartupEvent::Verifying);
                let connection = open_live(paths)?;
                validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;
                write_startup_metadata(&connection, None, None)?;
                state.store_connection(connection)?;
                Ok(())
            }
            SchemaInspection::Older { version } => {
                let backup_dir = self.backup_dir();
                // Sweep any temp files a previous crashed publication left
                // behind before publishing a fresh recovery point.
                let _ = cleanup_interrupted_publications(&backup_dir);

                self.set_startup_stage(Some(StartupStage::BackingUp));
                self.emit_startup_event(StartupEvent::BackingUp);
                let token = publish_backup(&paths.db_path, &backup_dir, BackupFailurePoint::None)?;

                self.set_startup_stage(Some(StartupStage::Migrating));
                self.emit_startup_event(StartupEvent::Migrating);
                self.await_migration_pause();

                let mut connection = open_live(paths)?;
                run_migrations(&mut connection, LATEST_SCHEMA_VERSION, FailurePoint::None)?;

                self.set_startup_stage(Some(StartupStage::Verifying));
                self.emit_startup_event(StartupEvent::Verifying);
                validate_manifest(&connection, LATEST_SCHEMA_VERSION)?;
                write_startup_metadata(&connection, Some(version), Some(token.path()))?;
                state.store_connection(connection)?;
                Ok(())
            }
            rejected => Err(classify_rejection(rejected)),
        }
    }
}

/// Map a rejected read-only classification to its stable error code with a
/// safe schema-version meta entry.
fn classify_rejection(inspection: SchemaInspection) -> DbError {
    match inspection {
        SchemaInspection::TooOld { version } => {
            DbError::new(ErrorCode::SchemaTooOld).with_meta("schema_version", version.to_string())
        }
        SchemaInspection::Newer { version } => {
            DbError::new(ErrorCode::SchemaTooNew).with_meta("schema_version", version.to_string())
        }
        SchemaInspection::Invalid { .. } => DbError::new(ErrorCode::DatabaseInvalid),
        // Unreachable from `perform_startup` (fresh/older/current are handled
        // before rejection), but required for an exhaustive match.
        _ => DbError::new(ErrorCode::DatabaseInvalid),
    }
}

/// A rejection is retryable only when re-running could plausibly succeed;
/// schema-too-old/new/invalid inputs need a restore instead.
fn is_retryable(code: ErrorCode) -> bool {
    !matches!(
        code,
        ErrorCode::SchemaTooOld | ErrorCode::SchemaTooNew | ErrorCode::DatabaseInvalid
    )
}

/// Write safe startup metadata on the live connection. Keys mirror the legacy
/// frontend metadata names; values are programmer-supplied strings, never raw
/// SQLite text, parameters, rows, or monetary values.
fn write_startup_metadata(
    connection: &rusqlite::Connection,
    migrated_from: Option<i64>,
    upgrade_backup_path: Option<&Path>,
) -> DbResult<()> {
    connection
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_successful_schema_version', ?1)",
            rusqlite::params![LATEST_SCHEMA_VERSION.to_string()],
        )
        .map_err(map_sqlite_error)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_successful_app_version', ?1)",
            rusqlite::params![env!("CARGO_PKG_VERSION").to_string()],
        )
        .map_err(map_sqlite_error)?;
    connection
        .execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_startup_at', ?1)",
            rusqlite::params![now_iso_utc()],
        )
        .map_err(map_sqlite_error)?;
    if let Some(version) = migrated_from {
        connection
            .execute(
                "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_migrated_from_schema', ?1)",
                rusqlite::params![version.to_string()],
            )
            .map_err(map_sqlite_error)?;
    }
    if let Some(path) = upgrade_backup_path {
        connection
            .execute(
                "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_upgrade_backup_path', ?1)",
                rusqlite::params![path.to_string_lossy().into_owned()],
            )
            .map_err(map_sqlite_error)?;
    }
    Ok(())
}
