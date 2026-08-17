//! backup_probe — subprocess helper for the interrupted-publication test.
//!
//! `publish-hang-after-copy` starts a real backup publication through
//! `publish_backup` with the `after_copy` failpoint armed and
//! `NOTCHY_BACKUP_HANG_AT=after_copy` set, so the failpoint hangs instead of
//! erroring. The parent test then SIGKILLs the process mid-publication,
//! leaving the unpublished `.tmp` file behind for restart-cleanup verification.

use std::path::Path;

use notchy_lib::database::backup::{publish_backup, BackupFailurePoint};

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: backup_probe <publish-hang-after-copy> <backup_dir> <source>");
        std::process::exit(2);
    });
    let backup_dir = std::env::args().nth(2).unwrap_or_else(|| {
        eprintln!("backup_dir is required");
        std::process::exit(2);
    });
    let source = std::env::args().nth(3).unwrap_or_else(|| {
        eprintln!("source is required");
        std::process::exit(2);
    });

    match mode.as_str() {
        "publish-hang-after-copy" => {
            // Make the after_copy failpoint hang so the parent can SIGKILL us
            // mid-publication and leave the .tmp file behind.
            std::env::set_var("NOTCHY_BACKUP_HANG_AT", "after_copy");
            let result =
                publish_backup(Path::new(&source), Path::new(&backup_dir), BackupFailurePoint::AfterCopy);
            // Unreachable while the failpoint hangs; an Ok here means the
            // failpoint never fired.
            eprintln!("backup_probe: publication returned unexpectedly: {result:?}");
            std::process::exit(3);
        }
        _ => {
            eprintln!("backup_probe: unknown mode: {mode}");
            std::process::exit(2);
        }
    }
}
