//! Shared harness for the protected-startup and command-guard integration
//! tests (Task 5). Kept out of the per-test crates so both `startup.rs` and
//! `command_guards.rs` exercise the exact same fixture and window plumbing.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};


use notchy_lib::database::connection::DatabasePaths;
use notchy_lib::database::error::DbResult;
use notchy_lib::database::executor::DatabaseManager;
use notchy_lib::database::types::StartupStage;

/// Path of the committed native fixtures, anchored to the crate manifest so the
/// tests work regardless of the invoking cwd.
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures"))
}

/// A unique scratch root for this test process and call.
pub fn scratch_root(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "notchy-startup-{}-{tag}-{nanos}",
        std::process::id()
    ))
}

/// Fresh config/data paths with the directories already created.
pub fn paths_for(tag: &str) -> DatabasePaths {
    let root = scratch_root(tag);
    let config = root.join("config");
    let data = root.join("data");
    std::fs::create_dir_all(&config).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    DatabasePaths::new(config, data)
}

/// Spawn a manager whose live database is a copy of a committed fixture.
pub async fn manager_for_fixture(fixture: &str) -> Arc<DatabaseManager> {
    let paths = paths_for(fixture);
    std::fs::copy(fixtures_dir().join(fixture), &paths.db_path)
        .unwrap_or_else(|error| panic!("fixture {fixture} must exist: {error}"));
    DatabaseManager::spawn(paths, 16).unwrap()
}

/// Spawn a manager whose database path is absent (a fresh bootstrap).
pub async fn manager_fresh() -> Arc<DatabaseManager> {
    DatabaseManager::spawn(paths_for("fresh"), 16).unwrap()
}

/// Run a data-job write as if issued from the window named `label`. Writes are
/// not main-only: any window may write once `Ready`, and the lifecycle guard is
/// what rejects writes while the database is not ready.
pub async fn write_as(_label: &str, manager: &Arc<DatabaseManager>) -> DbResult<()> {
    manager.data_job(|_state| Ok(())).await
}

/// Wait until the manager reports the given startup stage or time out.
pub async fn wait_until_stage(manager: &Arc<DatabaseManager>, target: StartupStage) {
    for _ in 0..1000 {
        if manager.startup_stage() == Some(target) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("manager never reached stage {target:?}");
}

