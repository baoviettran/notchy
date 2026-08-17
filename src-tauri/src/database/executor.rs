//! Dedicated database executor thread and sole live-connection ownership.
//!
//! Task 2 scope: the bounded job queue, the single executor thread, the
//! lifecycle snapshot, and the process lock held for the manager's lifetime.
//! Every job runs on the one executor thread; the live `rusqlite::Connection`
//! (opened by the startup task) will be stored in [`ExecutorState`] and never
//! crosses threads.

use std::sync::mpsc::{Receiver, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;

use crate::database::connection::DatabasePaths;
use crate::database::error::{DbError, DbResult, ErrorCode};
use crate::database::lock::ProcessLock;
use crate::database::startup::StartupEvent;
use crate::database::types::{LifecycleState, RecoveryContext, StartupStage};

/// One complete synchronous database operation, executed on the executor thread.
pub type Job = Box<dyn FnOnce(&mut ExecutorState) + Send + 'static>;

/// Executor-private message; `Shutdown` wakes an idle executor to exit.
enum Message {
    Job(Job),
    Shutdown,
}

/// Mutable state owned exclusively by the executor thread.
///
/// The sole live `rusqlite::Connection` (opened by the startup task) lives
/// here and never crosses threads; nothing in this state is ever accessed from
/// another thread.
pub struct ExecutorState {
    connection: Option<rusqlite::Connection>,
}

impl ExecutorState {
    pub(crate) fn new() -> Self {
        ExecutorState { connection: None }
    }

    /// The ID of the executor thread. Every job reports the same value.
    pub fn thread_id(&self) -> std::thread::ThreadId {
        std::thread::current().id()
    }

    /// The sole live connection, available only once the boundary is `Ready`.
    pub fn connection(&self) -> DbResult<&rusqlite::Connection> {
        self.connection
            .as_ref()
            .ok_or_else(|| DbError::new(ErrorCode::DatabaseNotReady))
    }

    /// Install the live connection opened by the startup sequence. Refuses to
    /// replace an existing connection; only `initialize` calls this.
    pub(crate) fn store_connection(&mut self, connection: rusqlite::Connection) -> DbResult<()> {
        if self.connection.is_some() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        self.connection = Some(connection);
        Ok(())
    }
}

/// A running database boundary: one executor thread, one process lock, and a
/// bounded job queue. Clone-free; share via `Arc<DatabaseManager>`.
pub struct DatabaseManager {
    sender: SyncSender<Message>,
    lifecycle: Arc<RwLock<LifecycleState>>,
    lock: Arc<ProcessLock>,
    handle: Mutex<Option<JoinHandle<()>>>,
    paths: DatabasePaths,
    startup_stage: Arc<RwLock<Option<StartupStage>>>,
    recovery: Arc<RwLock<Option<RecoveryContext>>>,
    startup_events: tokio::sync::broadcast::Sender<StartupEvent>,
    pub(crate) startup_lock: tokio::sync::Mutex<()>,
    migration_pause: Arc<Mutex<Option<std::sync::mpsc::Receiver<()>>>>,
}

impl DatabaseManager {
    /// Acquire the process lock and start the dedicated executor thread.
    ///
    /// Returns `DatabaseLocked` when another process already holds the lock;
    /// SQLite is never opened in that case. The lock is held for the manager's
    /// lifetime, so `initialize` always runs with the lock already held.
    pub fn spawn(paths: DatabasePaths, queue_capacity: usize) -> DbResult<Arc<DatabaseManager>> {
        let lock = Arc::new(ProcessLock::acquire(&paths.lock_file())?);
        let (sender, receiver) = sync_channel::<Message>(queue_capacity);
        let lifecycle = Arc::new(RwLock::new(LifecycleState::Uninitialized));
        let handle = spawn_executor(receiver, Arc::clone(&lock));
        let (startup_events, _) = tokio::sync::broadcast::channel(64);
        Ok(Arc::new(DatabaseManager {
            sender,
            lifecycle,
            lock,
            handle: Mutex::new(Some(handle)),
            paths,
            startup_stage: Arc::new(RwLock::new(None)),
            recovery: Arc::new(RwLock::new(None)),
            startup_events,
            startup_lock: tokio::sync::Mutex::new(()),
            migration_pause: Arc::new(Mutex::new(None)),
        }))
    }

    /// Run a database operation on the executor thread and await its result.
    ///
    /// Waits for queue capacity without blocking the async runtime; a full
    /// queue is a transient condition, so this is the "waiting" variant.
    pub async fn call<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut ExecutorState) -> DbResult<T> + Send + 'static,
    {
        let (response_tx, response_rx) = tokio::sync::oneshot::channel::<DbResult<T>>();
        let job: Job = Box::new(move |state| {
            let _ = response_tx.send(operation(state));
        });
        let mut message = Message::Job(job);
        loop {
            match self.sender.try_send(message) {
                Ok(()) => break,
                Err(TrySendError::Full(pending)) => {
                    message = pending;
                    tokio::task::yield_now().await;
                }
                Err(TrySendError::Disconnected(_)) => {
                    return Err(DbError::new(ErrorCode::DatabaseNotReady));
                }
            }
        }
        response_rx.await.map_err(|_| DbError::new(ErrorCode::DatabaseNotReady))?
    }

    /// Enqueue and wait for a database operation, or fail closed with
    /// `DatabaseBusy` when the bounded queue is full.
    pub fn try_call<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut ExecutorState) -> DbResult<T> + Send + 'static,
    {
        let (response_tx, response_rx) = std::sync::mpsc::sync_channel::<DbResult<T>>(1);
        let job: Job = Box::new(move |state| {
            let _ = response_tx.send(operation(state));
        });
        self.sender.try_send(Message::Job(job)).map_err(|error| match error {
            TrySendError::Full(_) => DbError::new(ErrorCode::DatabaseBusy),
            TrySendError::Disconnected(_) => DbError::new(ErrorCode::DatabaseNotReady),
        })?;
        response_rx.recv().map_err(|_| DbError::new(ErrorCode::DatabaseNotReady))?
    }

    /// The protected lifecycle snapshot, read without waiting for SQLite.
    pub fn snapshot(&self) -> LifecycleState {
        match self.lifecycle.read() {
            Ok(guard) => *guard,
            Err(_) => LifecycleState::RecoveryRequired,
        }
    }

    /// The authoritative process lock held for this manager's lifetime.
    pub fn process_lock(&self) -> &ProcessLock {
        &self.lock
    }

    /// Signal the executor to stop and wait for it to finish the in-flight job.
    pub fn shutdown(&self) {
        // Blocking send is acceptable here: shutdown is an application-lifetime
        // event and the executor drains the queue between jobs.
        let _ = self.sender.send(Message::Shutdown);
        if let Ok(mut guard) = self.handle.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }

    /// Run a database operation guarded by the lifecycle: only `Ready` callers
    /// reach the executor. This is the single data-job entry point.
    pub async fn data_job<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut ExecutorState) -> DbResult<T> + Send + 'static,
    {
        self.ensure_ready()?;
        self.call(operation).await
    }

    /// The lifecycle guard shared by every data-job entry point.
    pub fn ensure_ready(&self) -> DbResult<()> {
        match self.snapshot() {
            LifecycleState::Ready => Ok(()),
            LifecycleState::Uninitialized | LifecycleState::Initializing => {
                Err(DbError::new(ErrorCode::DatabaseUpdateRequired))
            }
            LifecycleState::RecoveryRequired | LifecycleState::Restoring => {
                Err(DbError::new(ErrorCode::RecoveryRequired))
            }
        }
    }

    /// Subscribe to startup progress events (`checking`, `backing_up`,
    /// `migrating`, `verifying`, `ready`, `recovery_required`).
    pub fn subscribe_startup(&self) -> tokio::sync::broadcast::Receiver<StartupEvent> {
        self.startup_events.subscribe()
    }

    /// The active startup stage, or `None` outside initialization.
    pub fn startup_stage(&self) -> Option<StartupStage> {
        match self.startup_stage.read() {
            Ok(guard) => *guard,
            Err(_) => None,
        }
    }

    /// The recovery context retained after a failed startup, if any.
    pub fn recovery_context(&self) -> Option<RecoveryContext> {
        match self.recovery.read() {
            Ok(guard) => guard.clone(),
            Err(_) => None,
        }
    }

    /// The directory where verified backups are published and discovered.
    pub fn backup_dir(&self) -> std::path::PathBuf {
        self.paths.data_dir.join("backups")
    }

    /// Test-only: arm a one-shot pause at the migration stage. The returned
    /// sender must be kept alive; firing it resumes the blocked migration. The
    /// receiver is consumed by the first migration that reaches the pause
    /// point, so a leftover pause can never stall a later startup.
    #[doc(hidden)]
    pub fn arm_migration_pause(&self) -> std::sync::mpsc::Sender<()> {
        let (tx, rx) = std::sync::mpsc::channel();
        *self.migration_pause.lock().unwrap() = Some(rx);
        tx
    }

    /// The resolved native paths. `pub(crate)`: the startup task reads these;
    /// callers use the public `backup_dir` accessor.
    pub(crate) fn paths(&self) -> &DatabasePaths {
        &self.paths
    }

    pub(crate) fn set_lifecycle(&self, state: LifecycleState) {
        if let Ok(mut guard) = self.lifecycle.write() {
            *guard = state;
        }
    }

    pub(crate) fn set_startup_stage(&self, stage: Option<StartupStage>) {
        if let Ok(mut guard) = self.startup_stage.write() {
            *guard = stage;
        }
    }

    pub(crate) fn set_recovery(&self, context: Option<RecoveryContext>) {
        if let Ok(mut guard) = self.recovery.write() {
            *guard = context;
        }
    }

    pub(crate) fn emit_startup_event(&self, event: StartupEvent) {
        let _ = self.startup_events.send(event);
    }

    /// Block the executor at the migration stage when the one-shot test pause
    /// is armed; a no-op in production.
    pub(crate) fn await_migration_pause(&self) {
        let receiver = self.migration_pause.lock().unwrap().take();
        if let Some(receiver) = receiver {
            let _ = receiver.recv();
        }
    }
}

fn spawn_executor(receiver: Receiver<Message>, lock: Arc<ProcessLock>) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name("notchy-db-executor".to_string())
        .spawn(move || {
            // Hold the process lock for the executor's lifetime: no second
            // process may open SQLite while any database work is possible.
            let _held_lock = lock;
            let mut state = ExecutorState::new();
            while let Ok(message) = receiver.recv() {
                match message {
                    Message::Job(job) => job(&mut state),
                    Message::Shutdown => break,
                }
            }
        })
        .expect("failed to spawn database executor thread")
}
