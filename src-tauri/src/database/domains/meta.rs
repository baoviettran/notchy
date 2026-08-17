//! Meta domain service — ported from `src/lib/db/repos/meta.ts` and
//! `src/lib/db/repos/quick_account.ts`.
//!
//! Settings (key-value on `app_meta` table) and quick-account support.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbResult, map_sqlite_error};

/// Key for the default quick-account setting.
const KEY_DEFAULT_QUICK_ACCOUNT: &str = "default_quick_account_id";

// ---------------------------------------------------------------------------
// Core meta operations
// ---------------------------------------------------------------------------

/// Get a meta value by key. Returns `None` if the key does not exist.
pub fn get_meta(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM app_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?;
    Ok(val)
}

/// Set a meta value (INSERT OR REPLACE).
pub fn set_meta(conn: &Connection, key: &str, value: &str) -> DbResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(map_sqlite_error)?;
    Ok(())
}

/// Delete a meta key.
pub fn delete_meta(conn: &Connection, key: &str) -> DbResult<()> {
    conn.execute("DELETE FROM app_meta WHERE key = ?1", [key])
        .map_err(map_sqlite_error)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

/// Check if the first-run flag is set.
pub fn is_first_run_complete(conn: &Connection) -> DbResult<bool> {
    let val = get_meta(conn, "first_run_complete")?;
    Ok(val.as_deref() == Some("1"))
}

/// Get the locale (defaults to "en").
pub fn get_locale(conn: &Connection) -> DbResult<String> {
    let val = get_meta(conn, "locale")?;
    Ok(val.unwrap_or_else(|| "en".to_string()))
}

/// Get the currency (defaults to "VND").
pub fn get_currency(conn: &Connection) -> DbResult<String> {
    let val = get_meta(conn, "currency")?;
    Ok(val.unwrap_or_else(|| "VND".to_string()))
}

/// Check if the tour is complete.
pub fn is_tour_complete(conn: &Connection) -> DbResult<bool> {
    let val = get_meta(conn, "tour_complete")?;
    Ok(val.as_deref() == Some("1"))
}

/// Mark the tour as complete.
pub fn set_tour_complete(conn: &Connection) -> DbResult<()> {
    set_meta(conn, "tour_complete", "1")
}

/// Mark first run as complete.
pub fn set_first_run_complete(conn: &Connection) -> DbResult<()> {
    set_meta(conn, "first_run_complete", "1")
}

// ---------------------------------------------------------------------------
// Quick account operations
// ---------------------------------------------------------------------------

/// Get the default quick-account ID.
pub fn get_default_quick_account(conn: &Connection) -> DbResult<Option<String>> {
    get_meta(conn, KEY_DEFAULT_QUICK_ACCOUNT)
}

/// Set the default quick-account ID.
pub fn set_default_quick_account(conn: &Connection, account_id: &str) -> DbResult<()> {
    set_meta(conn, KEY_DEFAULT_QUICK_ACCOUNT, account_id)
}

/// Clear the default quick-account.
pub fn clear_default_quick_account(conn: &Connection) -> DbResult<()> {
    delete_meta(conn, KEY_DEFAULT_QUICK_ACCOUNT)
}
