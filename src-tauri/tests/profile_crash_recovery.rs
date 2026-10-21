use notchy_lib::database::OperationId;
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::create::CreateFailurePoint;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn context() -> OperationContext {
    OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None }
}

#[tokio::test]
async fn restore_replays_one_identity_after_prepare_or_publish_interruption() {
    for point in [CreateFailurePoint::BeforePublish, CreateFailurePoint::AfterPublish] {
        let root = std::env::temp_dir().join(format!("notchy-restore-crash-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
        let source = coordinator.create("Original", &context()).await.unwrap();
        let source_path = paths.profile_dir(&source.id).unwrap().join("notchy.db");
        let preview = coordinator.inspect_restore(&source_path).await.unwrap();
        let operation = context();
        assert!(coordinator.restore_with_failpoint(&preview.token, "Recovered", &operation, point).await.is_err());
        drop(coordinator);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let records = restarted.load().profiles;
        assert_eq!(records.len(), 2);
        assert_ne!(records[0].id, records[1].id);
        assert_eq!(restarted.restore(&preview.token, "Recovered", &operation).await.unwrap().id, records[1].id);
        assert_eq!(restarted.load().profiles.len(), 2);
    }
}

#[test]
fn subprocess_create_replays_one_profile_after_interrupted_publication() {
    use std::process::Command;
    for point in ["before-publish", "after-publish"] {
        let root = std::env::temp_dir().join(format!("notchy-profile-probe-{}", OperationId::generate().as_str()));
        let operation_id = OperationId::generate().as_str().to_owned();
        let probe = env!("CARGO_BIN_EXE_profile_probe");
        let output = Command::new(probe).args(["create", root.to_str().unwrap(), &operation_id, point]).output().unwrap();
        assert!(!output.status.success(), "probe should exit after the injected interruption");
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let profiles = restarted.load().profiles;
        assert_eq!(profiles.len(), 1, "{point} must replay exactly one profile");
        assert!(paths.profile_dir(&profiles[0].id).unwrap().join("notchy.db").exists());
    }
}

fn run_probe(mode: &str, root: &std::path::Path, operation_id: &str, point: &str) {
    use std::process::Command;
    let probe = env!("CARGO_BIN_EXE_profile_probe");
    let output = Command::new(probe).args([mode, root.to_str().unwrap(), operation_id, point]).output().unwrap();
    assert_eq!(output.status.code(), Some(86), "{mode}/{point}: {}", String::from_utf8_lossy(&output.stderr));
}

#[tokio::test]
async fn subprocess_restore_replays_one_new_identity_at_prepare_and_publish() {
    for point in ["before-publish", "after-publish"] {
        let root = std::env::temp_dir().join(format!("notchy-restore-probe-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
        let original = coordinator.create("Original", &context()).await.unwrap();
        drop(coordinator);
        run_probe("restore", &root, &context().operation_id, point);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let profiles = restarted.load().profiles;
        assert_eq!(profiles.len(), 2, "{point}");
        assert_eq!(profiles.iter().filter(|p| p.name == "Recovered").count(), 1);
        assert!(profiles.iter().any(|p| p.id == original.id));
        for record in profiles { assert!(paths.profile_dir(&record.id).unwrap().join("notchy.db").exists()); }
    }
}

#[tokio::test]
async fn subprocess_delete_rolls_back_before_commit_and_never_resurrects_after_commit() {
    for (point, expected) in [("after-rename", 2), ("before-cleanup", 1)] {
        let root = std::env::temp_dir().join(format!("notchy-delete-probe-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
        let a = coordinator.create("A", &context()).await.unwrap();
        let b = coordinator.create("B", &context()).await.unwrap();
        drop(coordinator);
        run_probe("delete", &root, &context().operation_id, point);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        assert_eq!(restarted.load().profiles.len(), expected, "{point}");
        assert!(paths.profile_dir(&a.id).unwrap().join("notchy.db").exists());
        assert_eq!(paths.profile_dir(&b.id).unwrap().exists(), expected == 2);
        drop(restarted);
        assert_eq!(ProfileCoordinator::open(paths).unwrap().load().profiles.len(), expected);
    }
}

#[tokio::test]
async fn subprocess_adoption_reuses_one_profile_before_and_after_registry_commit() {
    for point in ["after-publish", "after-registry"] {
        let root = std::env::temp_dir().join(format!("notchy-adopt-probe-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        std::fs::create_dir_all(&paths.config_dir).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/v004.sqlite"), paths.config_dir.join("notchy.db")).unwrap();
        run_probe("adopt", &root, &context().operation_id, point);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let first = restarted.bootstrap().await.unwrap();
        assert_eq!(first.profiles.len(), 1, "{point}");
        let id = first.profiles[0].id.clone();
        drop(restarted);
        let again = ProfileCoordinator::open(paths.clone()).unwrap().bootstrap().await.unwrap();
        assert_eq!(again.profiles.len(), 1);
        assert_eq!(again.profiles[0].id, id);
        assert!(paths.profile_dir(&id).unwrap().join("notchy.db").exists());
    }
}

#[tokio::test]
async fn subprocess_reset_backup_write_failure_preserves_live_database() {
    let root = std::env::temp_dir().join(format!("notchy-reset-probe-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let record = coordinator.create("A", &context()).await.unwrap();
    let live = paths.profile_dir(&record.id).unwrap().join("notchy.db");
    let before = std::fs::read(&live).unwrap();
    drop(coordinator);
    run_probe("reset", &root, &context().operation_id, "after-copy");
    let restarted = ProfileCoordinator::open(paths).unwrap();
    assert_eq!(restarted.load().profiles, vec![record]);
    assert_eq!(std::fs::read(live).unwrap(), before);
}

#[tokio::test]
async fn subprocess_reset_reopens_old_or_new_database_at_each_swap_phase() {
    for point in ["after-backup", "after-prepared", "after-move-original", "after-move-replacement", "after-commit"] {
        let root = std::env::temp_dir().join(format!("notchy-reset-swap-probe-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
        let record = coordinator.create("A", &context()).await.unwrap();
        let live = paths.profile_dir(&record.id).unwrap().join("notchy.db");
        let db = rusqlite::Connection::open(&live).unwrap();
        db.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('probe_marker', 'before')", []).unwrap();
        drop(db);
        drop(coordinator);
        run_probe("reset-crash", &root, &context().operation_id, point);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        assert_eq!(restarted.load().profiles, vec![record.clone()], "{point}");
        let db = rusqlite::Connection::open(&live).unwrap();
        let marker: Option<String> = db.query_row("SELECT value FROM app_meta WHERE key='probe_marker'", [], |row| row.get(0)).ok();
        assert_eq!(marker.as_deref(), if point == "after-backup" { Some("before") } else { None }, "{point}");
        assert_eq!(db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0)).unwrap(), "ok");
        assert!(!restarted.backups(&record.id).await.unwrap().is_empty());
    }
}

#[test]
fn second_process_cannot_modify_profiles_while_the_first_owns_the_application_lock() {
    use std::process::Command;
    let root = std::env::temp_dir().join(format!("notchy-profile-lock-probe-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let holder = ProfileCoordinator::open(paths.clone()).unwrap();
    let probe = env!("CARGO_BIN_EXE_profile_probe");
    let output = Command::new(probe).args(["create", root.to_str().unwrap(), &context().operation_id, "after-publish"]).output().unwrap();
    assert!(!output.status.success());
    assert_ne!(output.status.code(), Some(86), "locked operation must never reach publication");
    assert!(holder.load().profiles.is_empty());
    drop(holder);
    assert!(ProfileCoordinator::open(paths).unwrap().load().profiles.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn read_only_export_directory_leaves_the_selected_profile_unchanged() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!("notchy-profile-readonly-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let record = coordinator.create("A", &context()).await.unwrap();
    let live = paths.profile_dir(&record.id).unwrap().join("notchy.db");
    let before = std::fs::read(&live).unwrap();
    let external = root.join("read-only");
    std::fs::create_dir_all(&external).unwrap();
    std::fs::set_permissions(&external, std::fs::Permissions::from_mode(0o500)).unwrap();
    let destination = external.join("backup.sqlite");
    assert!(coordinator.export_backup(&record.id, &destination).await.is_err());
    std::fs::set_permissions(&external, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!destination.exists());
    assert_eq!(coordinator.load().profiles, vec![record]);
    assert_eq!(std::fs::read(live).unwrap(), before);
}

#[tokio::test]
async fn subprocess_create_and_restore_keep_one_identity_after_registry_commit() {
    for mode in ["create-crash", "restore-crash"] {
        let root = std::env::temp_dir().join(format!("notchy-registry-probe-{}", OperationId::generate().as_str()));
        let paths = ProfilePaths::new(root.join("config"), root.join("data"));
        if mode == "restore-crash" {
            let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
            coordinator.create("Original", &context()).await.unwrap();
        }
        let operation = context();
        run_probe(mode, &root, &operation.operation_id, "after-registry");
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let count = if mode == "create-crash" { 1 } else { 2 };
        assert_eq!(restarted.load().profiles.len(), count);
        let ids: std::collections::HashSet<_> = restarted.load().profiles.iter().map(|p| p.id.clone()).collect();
        assert_eq!(ids.len(), count);
        for id in ids { assert!(paths.profile_dir(&id).unwrap().join("notchy.db").exists()); }
        drop(restarted);
        assert_eq!(ProfileCoordinator::open(paths).unwrap().load().profiles.len(), count);
    }
}

#[tokio::test]
async fn subprocess_delete_does_not_resurrect_after_registry_commit() {
    let root = std::env::temp_dir().join(format!("notchy-delete-registry-probe-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    drop(coordinator);
    run_probe("delete-crash", &root, &context().operation_id, "after-registry");
    let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
    assert_eq!(restarted.load().profiles, vec![a.clone()]);
    assert!(!paths.profile_dir(&b.id).unwrap().exists());
    drop(restarted);
    assert_eq!(ProfileCoordinator::open(paths).unwrap().load().profiles, vec![a]);
}
