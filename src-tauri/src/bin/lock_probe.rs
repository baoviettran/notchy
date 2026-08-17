//! lock_probe — subprocess helper for the two-process OS lock test.
//!
//! The test spawns one probe in `hold` mode (acquires the lock and holds it)
//! and one in `try-open` mode. The losing process must fail to acquire the
//! lock and therefore must print exactly `database_locked\nsqlite_opened=false`
//! without ever opening SQLite.

use std::path::PathBuf;

use notchy_lib::database::connection::{open_live, DatabasePaths};
use notchy_lib::database::error::ErrorCode;
use notchy_lib::database::lock::ProcessLock;

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: lock_probe <hold|try-open>");
        std::process::exit(2);
    });
    let config_dir = std::env::var("NOTCHY_CONFIG_DIR").unwrap_or_else(|_| {
        eprintln!("NOTCHY_CONFIG_DIR is required");
        std::process::exit(2);
    });
    let db_dir = std::env::var("NOTCHY_DB_DIR").unwrap_or_else(|_| {
        eprintln!("NOTCHY_DB_DIR is required");
        std::process::exit(2);
    });
    let paths = DatabasePaths::new(PathBuf::from(config_dir), PathBuf::from(db_dir));

    match mode.as_str() {
        "hold" => {
            let _lock = ProcessLock::acquire(&paths.lock_file()).unwrap_or_else(|error| {
                eprintln!("lock_probe: failed to acquire lock: {error:?}");
                std::process::exit(2);
            });
            println!("lock_held");
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
        "try-open" => match ProcessLock::acquire(&paths.lock_file()) {
            Ok(_lock) => {
                let _connection = open_live(&paths).unwrap_or_else(|error| {
                    eprintln!("lock_probe: failed to open live database: {error:?}");
                    std::process::exit(2);
                });
                println!("database_opened");
            }
            Err(error) if error.code == ErrorCode::DatabaseLocked => {
                println!("database_locked\nsqlite_opened=false");
            }
            Err(error) => {
                eprintln!("lock_probe: unexpected lock error: {error:?}");
                std::process::exit(2);
            }
        },
        _ => {
            eprintln!("lock_probe: unknown mode: {mode}");
            std::process::exit(2);
        }
    }
}
