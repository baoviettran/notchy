//! Executor ownership and bounded-queue tests (Task 2).
//!
//! Proves every job runs on the one dedicated executor thread, and that the
//! bounded queue fails closed with `database_busy` instead of growing without
//! limit.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use notchy_lib::database::connection::DatabasePaths;
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::executor::DatabaseManager;

/// Fresh temp paths per call so tests never contend for the same lockfile.
fn test_paths() -> DatabasePaths {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let base =
        std::env::temp_dir().join(format!("notchy-exec-test-{}-{}", std::process::id(), n));
    let config = base.join("config");
    let data = base.join("data");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    DatabasePaths::new(config, data)
}

/// A manager whose executor can be blocked so the bounded queue can be filled.
fn blocked_manager(queue_capacity: usize) -> Arc<DatabaseManager> {
    DatabaseManager::spawn(test_paths(), queue_capacity).unwrap()
}

/// Park the executor thread, then occupy the bounded queue so the next
/// non-waiting send fails closed with `database_busy`.
async fn fill_running_and_pending_jobs(manager: &Arc<DatabaseManager>) {
    // A job that blocks the executor forever. It signals immediately before
    // parking so the caller knows the running slot is permanently occupied.
    let (parked_tx, parked_rx) = tokio::sync::oneshot::channel::<()>();
    let blocker = Arc::clone(manager);
    tokio::spawn(async move {
        let _ = blocker
            .call(move |_state| {
                let _ = parked_tx.send(());
                std::thread::park();
                Ok(())
            })
            .await;
    });
    // Wait until the executor is inside the parking job. The executor sends
    // this signal immediately before parking, so once this returns the running
    // slot is permanently occupied and the queue can never drain.
    parked_rx.await.expect("executor must signal before parking");

    // Fire-and-forget fillers occupy the bounded queue. The first fills the
    // single buffer slot; the second proves it can never be enqueued.
    for _ in 0..2 {
        let filler = Arc::clone(manager);
        tokio::spawn(async move {
            let _ = filler.call(|_state| Ok(())).await;
        });
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn executor_runs_every_job_on_one_thread() {
    let manager = DatabaseManager::spawn(test_paths(), 2).unwrap();
    let first = manager.call(|state| Ok(state.thread_id())).await.unwrap();
    let second = manager.call(|state| Ok(state.thread_id())).await.unwrap();
    assert_eq!(first, second);
}

#[tokio::test]
async fn bounded_queue_fails_closed() {
    let manager = blocked_manager(1);
    fill_running_and_pending_jobs(&manager).await;
    assert_eq!(
        manager.try_call(|_| Ok(())).unwrap_err().code,
        ErrorCode::DatabaseBusy
    );
}
