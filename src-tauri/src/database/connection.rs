//! Connection policy: exact paths, read-only open, live pragmas, permissions,
//! and the legacy-WAL transition.
//!
//! Task 2 scope: `DatabasePaths`, `open_read_only` (SQLite URI `mode=ro`, never
//! writable), and `open_live` with the exact pragma order. The 0700/0600 Unix
//! permission helpers are shared with the process lock.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::database::error::{DbError, DbResult, ErrorCode};

/// Live database filename. Must stay `notchy.db` so the native boundary
/// resolves the existing application-config database exactly and never creates
/// a second database beside it.
const LIVE_DATABASE_FILENAME: &str = "notchy.db";

/// Authoritative OS lockfile name, kept in the application-config directory.
const LOCK_FILENAME: &str = "notchy.lock";

/// Resolved native database paths.
///
/// Mirrors the frontend `computeDatabasePaths`: the live database lives in the
/// application-config directory (`config_dir/notchy.db`), while backups live
/// below the application-data directory.
#[derive(Debug, Clone)]
pub struct DatabasePaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
}

impl DatabasePaths {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let db_path = config_dir.join(LIVE_DATABASE_FILENAME);
        DatabasePaths {
            config_dir,
            data_dir,
            db_path,
        }
    }

    /// The authoritative OS lockfile path, in the application-config directory.
    pub fn lock_file(&self) -> PathBuf {
        self.config_dir.join(LOCK_FILENAME)
    }
}

/// Open the sole live connection and apply the exact connection policy.
///
/// The caller must already hold the process lock; this function never acquires
/// it.
pub fn open_live(paths: &DatabasePaths) -> DbResult<rusqlite::Connection> {
    create_dir_private(&paths.config_dir).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    create_dir_private(&paths.data_dir).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    open_live_at(&paths.db_path)
}

/// Open a live connection at an arbitrary path and apply the exact connection
/// policy. Used by the migration/bootstrap services for fixtures and staged
/// databases; `open_live` delegates here.
pub(crate) fn open_live_at(path: &Path) -> DbResult<rusqlite::Connection> {
    let connection = rusqlite::Connection::open(path).map_err(map_open_error)?;
    #[cfg(unix)]
    set_private_file_permissions(path)
        .map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
    apply_live_policy(&connection)?;
    Ok(connection)
}

/// Apply the exact live-connection pragma order.
///
/// Pragma order (design constraint): `foreign_keys=ON`, `busy_timeout=5000`, a
/// legacy WAL checkpoint when a WAL journal is detected, `journal_mode=DELETE`,
/// then `synchronous=FULL`.
pub(crate) fn apply_live_policy(connection: &rusqlite::Connection) -> DbResult<()> {
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(map_open_error)?;
    connection
        .busy_timeout(Duration::from_millis(5000))
        .map_err(map_open_error)?;

    // Legacy WAL checkpoint before switching to the rollback journal, so no
    // WAL/SHM sidecars survive the transition.
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(map_open_error)?;
    if journal_mode.eq_ignore_ascii_case("wal") {
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .map_err(map_open_error)?;
    }

    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(map_open_error)?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(map_open_error)?;

    Ok(())
}

/// Open a true read-only connection using the SQLite URI `mode=ro`.
///
/// Never runs writable pragmas and never creates the database file. Used for
/// candidate inspection before any live connection opens.
pub fn open_read_only(paths: &DatabasePaths) -> DbResult<rusqlite::Connection> {
    open_read_only_at(&paths.db_path)
}

/// Open a true read-only connection at an arbitrary path. Never runs writable
/// pragmas and never creates the database file.
pub(crate) fn open_read_only_at(path: &Path) -> DbResult<rusqlite::Connection> {
    use rusqlite::OpenFlags;

    // Percent-encode the path so characters SQLite treats as URI delimiters
    // (`?`, `#`) or escapes (`%`) cannot corrupt the filename.
    let uri = format!("file:{}?mode=ro", encode_uri_path(path));
    rusqlite::Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(map_open_error)
}

/// Percent-encode a filesystem path for use as a SQLite URI body.
///
/// Keeps unreserved URI characters and the `/` separator literal; every other
/// byte is UTF-8 percent-encoded.
fn encode_uri_path(path: &Path) -> String {
    let mut out = String::new();
    for byte in path.to_string_lossy().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'-' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Map a rusqlite error to the stable allowlisted envelope. The raw SQLite text
/// never reaches the error envelope or the logs.
fn map_open_error(error: rusqlite::Error) -> DbError {
    let code = match &error {
        rusqlite::Error::SqliteFailure(sqlite_error, _) => match sqlite_error.code {
            rusqlite::ErrorCode::DatabaseBusy => ErrorCode::DatabaseBusy,
            rusqlite::ErrorCode::DatabaseLocked => ErrorCode::DatabaseLocked,
            rusqlite::ErrorCode::CannotOpen => ErrorCode::DatabaseInvalid,
            _ => ErrorCode::DatabaseCorrupt,
        },
        _ => ErrorCode::DatabaseCorrupt,
    };
    DbError::new(code)
}

/// Ensure `path` exists as a directory with 0700 permissions on Unix.
#[cfg(unix)]
pub(crate) fn create_dir_private(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

/// Ensure `path` exists as a directory.
#[cfg(not(unix))]
pub(crate) fn create_dir_private(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)
}

/// Force 0600 permissions on a created file on Unix.
#[cfg(unix)]
pub(crate) fn set_private_file_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

/// Force 0600 permissions on a created file (no-op off Unix).
#[cfg(not(unix))]
pub(crate) fn set_private_file_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(tag: &str) -> DatabasePaths {
        let base = std::env::temp_dir().join(format!(
            "notchy-conn-test-{}-{tag}",
            std::process::id()
        ));
        let config = base.join("config");
        let data = base.join("data");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(&data).unwrap();
        DatabasePaths::new(config, data)
    }

    #[test]
    fn paths_derive_exact_live_and_lock_locations() {
        let paths = DatabasePaths::new(
            PathBuf::from("/tmp/notchy-config"),
            PathBuf::from("/tmp/notchy-data"),
        );
        assert_eq!(paths.db_path, PathBuf::from("/tmp/notchy-config/notchy.db"));
        assert_eq!(
            paths.lock_file(),
            PathBuf::from("/tmp/notchy-config/notchy.lock")
        );
    }

    #[test]
    fn open_live_applies_exact_pragma_order() {
        let paths = temp_paths("pragmas");
        let db = open_live(&paths).unwrap();

        let foreign_keys: i64 = db
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1);

        let busy_timeout: i64 = db
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 5000);

        let journal_mode: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_ascii_lowercase(), "delete");

        let synchronous: i64 = db
            .query_row("PRAGMA synchronous", [], |row| row.get(0))
            .unwrap();
        assert_eq!(synchronous, 2);
    }

    #[test]
    fn open_live_checkpoints_legacy_wal_before_switching() {
        let paths = temp_paths("wal");
        {
            let db = rusqlite::Connection::open(&paths.db_path).unwrap();
            db.pragma_update(None, "journal_mode", "WAL").unwrap();
            db.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1);")
                .unwrap();
        }
        let before: String = rusqlite::Connection::open(&paths.db_path)
            .unwrap()
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(before.to_ascii_lowercase(), "wal");

        let db = open_live(&paths).unwrap();
        let after: String = db
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(after.to_ascii_lowercase(), "delete");
    }

    #[cfg(unix)]
    #[test]
    fn open_live_sets_private_directory_and_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let paths = temp_paths("permissions");
        let _db = open_live(&paths).unwrap();

        let config_mode = fs::metadata(&paths.config_dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(config_mode, 0o700);
        let data_mode = fs::metadata(&paths.data_dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(data_mode, 0o700);
        let db_mode = fs::metadata(&paths.db_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(db_mode, 0o600);
    }

    #[test]
    fn open_read_only_never_creates_the_database() {
        let paths = temp_paths("ro-missing");
        assert!(!paths.db_path.exists());
        let error = open_read_only(&paths).unwrap_err();
        assert_eq!(error.code, ErrorCode::DatabaseInvalid);
        assert!(!paths.db_path.exists());
    }

    #[test]
    fn open_read_only_opens_existing_file_without_writing() {
        let paths = temp_paths("ro-existing");
        let live = open_live(&paths).unwrap();
        live.execute_batch("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (7);")
            .unwrap();
        drop(live);

        let ro = open_read_only(&paths).unwrap();
        let value: i64 = ro.query_row("SELECT x FROM t", [], |row| row.get(0)).unwrap();
        assert_eq!(value, 7);
    }

    #[test]
    fn encode_uri_path_escapes_delimiters_and_non_ascii() {
        assert_eq!(
            encode_uri_path(Path::new("/tmp/a b?c#d% e/notchy.db")),
            "/tmp/a%20b%3Fc%23d%25%20e/notchy.db"
        );
    }

    #[test]
    fn open_read_only_handles_uri_special_characters_in_path() {
        let base = std::env::temp_dir().join(format!(
            "notchy ro?test#{}",
            std::process::id()
        ));
        let config = base.join("config");
        let data = base.join("data");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(&data).unwrap();
        let paths = DatabasePaths::new(config, data);

        let live = open_live(&paths).unwrap();
        live.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1);")
            .unwrap();
        drop(live);

        let ro = open_read_only(&paths).unwrap();
        let n: i64 = ro
            .query_row("SELECT COUNT(*) FROM t", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
