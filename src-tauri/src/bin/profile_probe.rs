//! Runs one journaled profile operation in a separate process, then exits at
//! an injected phase so integration tests can verify restart replay on disk.
use std::path::PathBuf;
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::create::CreateFailurePoint;
use notchy_lib::profiles::delete::DeleteFailurePoint;
use notchy_lib::profiles::legacy::AdoptionFailurePoint;
use notchy_lib::database::BackupFailurePoint;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: profile_probe <mode> <root> <operation_id> <point>");
        std::process::exit(2);
    }
    let root = PathBuf::from(&args[2]);
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).expect("open coordinator");
    let context = OperationContext { operation_id: args[3].clone(), transition_token: None };
    let result = match args[1].as_str() {
        "create-crash" => {
            std::env::set_var("NOTCHY_PROFILE_CREATE_CRASH_AT", &args[4]);
            let result = coordinator.create("Probe", &context).await;
            eprintln!("create returned without probe exit: {result:?}");
            std::process::exit(3);
        }
        "restore-crash" => {
            std::env::set_var("NOTCHY_PROFILE_CREATE_CRASH_AT", &args[4]);
            let source_id = coordinator.load().profiles.first().expect("source profile").id.clone();
            let source = paths.profile_dir(&source_id).unwrap().join("notchy.db");
            let preview = coordinator.inspect_restore(&source).await.expect("inspect source");
            let result = coordinator.restore(&preview.token, "Recovered", &context).await;
            eprintln!("restore returned without probe exit: {result:?}");
            std::process::exit(3);
        }
        "create" => {
            let point = match args[4].as_str() {
                "before-publish" => CreateFailurePoint::BeforePublish,
                "after-publish" => CreateFailurePoint::AfterPublish,
                _ => { eprintln!("unknown point"); std::process::exit(2); }
            };
            coordinator.create_with_failpoint("Probe", &context, point).await.map(|_| ())
        }
        "restore" => {
            let point = match args[4].as_str() {
                "before-publish" => CreateFailurePoint::BeforePublish,
                "after-publish" => CreateFailurePoint::AfterPublish,
                _ => { eprintln!("unknown point"); std::process::exit(2); }
            };
            let source_id = coordinator.load().profiles.first().expect("source profile").id.clone();
            let source = paths.profile_dir(&source_id).unwrap().join("notchy.db");
            let preview = coordinator.inspect_restore(&source).await.expect("inspect source");
            coordinator.restore_with_failpoint(&preview.token, "Recovered", &context, point).await.map(|_| ())
        }
        "delete-crash" => {
            std::env::set_var("NOTCHY_PROFILE_DELETE_CRASH_AT", &args[4]);
            let target = coordinator.load().profiles.last().expect("target profile").id.clone();
            let result = coordinator.delete(&target, &context, None).await;
            eprintln!("delete returned without probe exit: {result:?}");
            std::process::exit(3);
        }
        "delete" => {
            let point = match args[4].as_str() {
                "after-rename" => DeleteFailurePoint::AfterRename,
                "before-cleanup" => DeleteFailurePoint::BeforeCleanup,
                _ => { eprintln!("unknown point"); std::process::exit(2); }
            };
            let target = coordinator.load().profiles.last().expect("target profile").id.clone();
            let result = coordinator.delete_with_failpoint(&target, &context, None, point).await;
            if point == DeleteFailurePoint::BeforeCleanup {
                if !result.as_ref().is_ok_and(|outcome| outcome.cleanup_pending) { eprintln!("cleanup was not pending: {result:?}"); std::process::exit(3); }
                std::process::exit(86);
            }
            result.map(|_| ())
        }
        "adopt" => {
            let point = match args[4].as_str() {
                "after-publish" => AdoptionFailurePoint::AfterPublish,
                "after-registry" => AdoptionFailurePoint::AfterRegistry,
                _ => { eprintln!("unknown point"); std::process::exit(2); }
            };
            coordinator.adopt_legacy_with_failpoint(point).await
        }
        "reset-crash" => {
            std::env::set_var("NOTCHY_PROFILE_RESET_CRASH_AT", &args[4]);
            let target = coordinator.load().profiles.first().expect("target profile").id.clone();
            let result = coordinator.reset(&target, &context).await;
            eprintln!("reset returned without probe exit: {result:?}");
            std::process::exit(3);
        }
        "reset" => {
            if args[4] != "after-copy" { eprintln!("unknown point"); std::process::exit(2); }
            let target = coordinator.load().profiles.first().expect("target profile").id.clone();
            coordinator.reset_with_failpoint(&target, &context, BackupFailurePoint::AfterCopy).await
        }
        _ => { eprintln!("unknown mode"); std::process::exit(2); }
    };
    if result.is_ok() { eprintln!("failpoint did not interrupt operation"); std::process::exit(3); }
    // Do not run destructors: leave the exact journal and files for a new host.
    std::process::exit(86);
}
