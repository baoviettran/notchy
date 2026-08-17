//! Two-process OS lock exclusion tests (Task 2).
//!
//! The losing process must fail to acquire the authoritative lockfile and must
//! therefore never open SQLite: its output must be exactly
//! `database_locked\nsqlite_opened=false\n`.

use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::OnceLock;

/// Shared config/data directories for both probe processes so they contend
/// for the same lockfile. Created once per test process.
fn shared_dirs() -> &'static (PathBuf, PathBuf) {
    static DIRS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();
    DIRS.get_or_init(|| {
        let base =
            std::env::temp_dir().join(format!("notchy-process-lock-{}", std::process::id()));
        let config = base.join("config");
        let data = base.join("data");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        (config, data)
    })
}

fn probe_command(mode: &str) -> Command {
    let (config, data) = shared_dirs();
    let mut command = Command::new(env!("CARGO_BIN_EXE_lock_probe"));
    command
        .arg(mode)
        .env("NOTCHY_CONFIG_DIR", config)
        .env("NOTCHY_DB_DIR", data)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// Spawn a probe process and return the child handle.
///
/// For `hold` mode, blocks until the probe prints `lock_held`, which is its
/// acknowledgement that it acquired the lock. This closes the race between
/// the two probes.
fn spawn_lock_probe(mode: &str) -> Child {
    use std::io::{BufRead, BufReader};

    let mut child = probe_command(mode).spawn().unwrap();
    if mode == "hold" {
        let stdout = child.stdout.take().expect("hold probe stdout is piped");
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .unwrap_or_else(|error| panic!("reading lock probe output: {error}"));
        assert!(!line.is_empty(), "lock probe exited before holding the lock");
    }
    child
}

/// Run a probe to completion and return its output.
fn run_lock_probe(mode: &str) -> Output {
    probe_command(mode).output().unwrap()
}

/// Stop a running probe process.
fn stop(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn second_process_never_opens_sqlite() {
    let first = spawn_lock_probe("hold");
    let second = run_lock_probe("try-open");
    let stdout = std::str::from_utf8(&second.stdout).expect("probe stdout is UTF-8");
    assert_eq!(stdout, "database_locked\nsqlite_opened=false\n");
    stop(first);
}
