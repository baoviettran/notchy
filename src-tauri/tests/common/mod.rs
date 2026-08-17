//! Shared harness for the protected-startup and command-guard integration
//! tests (Task 5). Kept out of the per-test crates so both `startup.rs` and
//! `command_guards.rs` exercise the exact same fixture and window plumbing.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Manager;

use notchy_lib::database::connection::DatabasePaths;
use notchy_lib::database::error::DbResult;
use notchy_lib::database::executor::DatabaseManager;
use notchy_lib::database::startup::DatabaseStatus;
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

/// A Tauri mock app with `main` and `quick-add` windows and the manager
/// managed as state, so guarded command functions can be invoked with real
/// window labels.
pub struct MockApp {
    pub app: tauri::App<tauri::test::MockRuntime>,
    pub main: tauri::WebviewWindow<tauri::test::MockRuntime>,
    pub quick_add: tauri::WebviewWindow<tauri::test::MockRuntime>,
}

pub fn mock_app(manager: Arc<DatabaseManager>) -> MockApp {
    let app = tauri::test::mock_builder()
        .manage(manager)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock app");
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build main mock window");
    let quick_add = tauri::WebviewWindowBuilder::new(&app, "quick-add", Default::default())
        .build()
        .expect("failed to build quick-add mock window");
    MockApp {
        app,
        main,
        quick_add,
    }
}

/// Invoke `database_initialize` as if called from the window named `label`.
pub async fn initialize_as(
    label: &str,
    manager: &Arc<DatabaseManager>,
) -> DbResult<DatabaseStatus> {
    let app = mock_app(Arc::clone(manager));
    let window = if label == "main" {
        app.main.clone()
    } else {
        app.quick_add.clone()
    };
    let state = app.app.state::<Arc<DatabaseManager>>();
    notchy_lib::database::commands::database_initialize(window, state).await
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

/// Poll the database path until it exists (used when a bootstrap publishes the
/// live file asynchronously).
pub fn wait_for_path(path: &Path) {
    for _ in 0..1000 {
        if path.exists() {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    panic!("path never appeared: {}", path.display());
}
