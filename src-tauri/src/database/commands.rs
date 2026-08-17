//! Native command guards: main-only startup commands and the window-label
//! authorization check (Task 5).
//!
//! Only the `main` window may request initialization, retry, or status. The
//! check runs on `WebviewWindow::label()` and is authoritative regardless of
//! what the capability files expose — frontend routing is presentation, not
//! authorization.
//!
//! These command functions are intentionally NOT registered with Tauri yet.
//! Task 14 performs the atomic production cutover and registers them.

use std::sync::Arc;

use tauri::State;

use crate::database::error::{DbError, DbResult, ErrorCode};
use crate::database::executor::DatabaseManager;
use crate::database::startup::DatabaseStatus;

/// The label of the only window permitted to request startup operations.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Reject callers that are not the main window.
pub(crate) fn assert_main_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> DbResult<()> {
    if window.label() == MAIN_WINDOW_LABEL {
        Ok(())
    } else {
        Err(DbError::new(ErrorCode::InvalidInput))
    }
}

/// Initialize the native database boundary. Main-window only.
#[tauri::command]
pub async fn database_initialize<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.initialize().await
}

/// Retry a failed startup. Main-window only.
#[tauri::command]
pub async fn database_retry<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.retry().await
}

/// Query the current database status. Main-window only.
#[tauri::command]
pub async fn database_status<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    manager: State<'_, Arc<DatabaseManager>>,
) -> Result<DatabaseStatus, DbError> {
    assert_main_window(&window)?;
    manager.status()
}
