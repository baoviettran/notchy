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
use crate::database::types::LifecycleState;

/// One complete synchronous database operation, executed on the executor thread.
pub type Job = Box<dyn FnOnce(&mut ExecutorState) + Send + 'static>;

/// Executor-private message; `Shutdown` wakes an idle executor to exit.
enum Message {
    Job(Job),
    Shutdown,
}

/// Mutable state owned exclusively by the executor thread.
///
/// Later tasks add the live connection and migration/backup context here;
/// nothing in this state is ever accessed from another thread.
pub struct ExecutorState;

impl ExecutorState {
    pub(crate) fn new() -> Self {
        ExecutorState
    }

    /// The ID of the executor thread. Every job reports the same value.
    pub fn thread_id(&self) -> std::thread::ThreadId {
        std::thread::current().id()
    }
}

/// A running database boundary: one executor thread, one process lock, and a
/// bounded job queue. Clone-free; share via `Arc<DatabaseManager>`.
pub struct DatabaseManager {
    sender: SyncSender<Message>,
    lifecycle: Arc<RwLock<LifecycleState>>,
    lock: Arc<ProcessLock>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl DatabaseManager {
    /// Acquire the process lock and start the dedicated executor thread.
    ///
    /// Returns `DatabaseLocked` when another process already holds the lock;
    /// SQLite is never opened in that case.
    pub fn spawn(paths: DatabasePaths, queue_capacity: usize) -> DbResult<Arc<DatabaseManager>> {
        let lock = Arc::new(ProcessLock::acquire(&paths.lock_file())?);
        let (sender, receiver) = sync_channel::<Message>(queue_capacity);
        let lifecycle = Arc::new(RwLock::new(LifecycleState::Uninitialized));
        let handle = spawn_executor(receiver, Arc::clone(&lock));
        Ok(Arc::new(DatabaseManager {
            sender,
            lifecycle,
            lock,
            handle: Mutex::new(Some(handle)),
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
