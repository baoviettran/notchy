//! Authoritative OS lockfile.
//!
//! Acquired once per process, before any SQLite connection opens, and held for
//! the `DatabaseManager` lifetime. On Unix this is an exclusive advisory lock
//! (`flock` via fs2); the kernel releases it automatically on process exit, so
//! a crashed process never leaves a stale lock behind.

use std::fs::OpenOptions;
use std::path::{Path, PathBuf};

use crate::database::connection::{create_dir_private, set_private_file_permissions};
use crate::database::error::{DbError, DbResult, ErrorCode};

/// A held exclusive OS lock on the authoritative lockfile.
pub struct ProcessLock {
    _file: std::fs::File,
    _path: PathBuf,
}

impl ProcessLock {
    /// Acquire an exclusive lock on `path`, creating the file if absent.
    ///
    /// Fails closed with [`ErrorCode::DatabaseLocked`] when another process
    /// already holds the lock. The caller must treat a failed acquire as "do
    /// not open SQLite".
    pub fn acquire(path: &Path) -> DbResult<ProcessLock> {
        let parent = path
            .parent()
            .ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
        create_dir_private(parent).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(path)
            .map_err(|_| DbError::new(ErrorCode::DatabaseLocked))?;

        set_private_file_permissions(path).map_err(|_| DbError::new(ErrorCode::DatabaseLocked))?;

        use fs2::FileExt;
        file.try_lock_exclusive()
            .map_err(|_| DbError::new(ErrorCode::DatabaseLocked))?;

        Ok(ProcessLock {
            _file: file,
            _path: path.to_path_buf(),
        })
    }
}
