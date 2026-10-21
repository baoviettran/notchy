use std::{fs, path::PathBuf};
use notchy_lib::database::{BackupFailurePoint, ErrorCode, OperationId};
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;
use notchy_lib::profiles::delete::DeleteFailurePoint;

fn fixture() -> (ProfilePaths, std::sync::Arc<ProfileCoordinator>) {
    let root = std::env::temp_dir().join(format!("notchy-profile-reset-delete-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    (paths, coordinator)
}
fn context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None } }

#[tokio::test]
async fn reset_preserves_identity_and_backup_but_replaces_financial_database() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    let a_db = paths.profile_dir(&a.id).unwrap().join("notchy.db");
    let b_db = paths.profile_dir(&b.id).unwrap().join("notchy.db");
    let connection = rusqlite::Connection::open(&a_db).unwrap();
    connection.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('tour_completed', 'yes')", []).unwrap();
    drop(connection);
    let before = fs::read(&a_db).unwrap();
    let b_before = fs::read(&b_db).unwrap();
    coordinator.reset(&a.id, &context()).await.unwrap();
    assert_eq!(coordinator.load().profiles[0], a);
    assert_ne!(fs::read(&a_db).unwrap(), before);
    assert_eq!(fs::read(&b_db).unwrap(), b_before);
    assert!(!coordinator.backups(&a.id).await.unwrap().is_empty());
    let connection = rusqlite::Connection::open(&a_db).unwrap();
    let tour: Option<String> = connection.query_row("SELECT value FROM app_meta WHERE key = 'tour_completed'", [], |r| r.get(0)).ok();
    assert!(tour.is_none());
}

#[tokio::test]
async fn backup_failure_leaves_original_database_and_registry_untouched() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let db = paths.profile_dir(&a.id).unwrap().join("notchy.db");
    let before = fs::read(&db).unwrap();
    assert!(coordinator.reset_with_failpoint(&a.id, &context(), BackupFailurePoint::AfterCopy).await.is_err());
    assert_eq!(fs::read(&db).unwrap(), before);
    assert_eq!(coordinator.load().profiles, vec![a]);
}

#[tokio::test]
async fn active_reset_advances_generation_and_delete_last_returns_to_picker() {
    let (_, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let old = coordinator.activate(&a.id).await.unwrap();
    let missing_token = coordinator.reset(&a.id, &context()).await.unwrap_err();
    assert_eq!(missing_token.code, ErrorCode::ProfileTransitionBlocked);
    let reset_context = OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: Some(coordinator.issue_transition_token()) };
    coordinator.reset(&a.id, &reset_context).await.unwrap();
    assert_ne!(coordinator.load().active.unwrap().generation, old.generation);
    let delete_context = OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: Some(coordinator.issue_transition_token()) };
    coordinator.delete(&a.id, &delete_context, None).await.unwrap();
    assert!(coordinator.load().profiles.is_empty());
    assert!(coordinator.load().active.is_none());
}

#[tokio::test]
async fn inactive_delete_preserves_active_and_cleanup_replays_without_resurrection() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    let active = coordinator.activate(&a.id).await.unwrap();
    let outcome = coordinator.delete_with_failpoint(&b.id, &context(), None, DeleteFailurePoint::BeforeCleanup).await.unwrap();
    assert!(outcome.cleanup_pending);
    assert_eq!(coordinator.load().active, Some(active));
    assert_eq!(coordinator.load().profiles, vec![a.clone()]);
    drop(coordinator);
    let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
    assert_eq!(restarted.load().profiles, vec![a]);
    assert!(!paths.profile_dir(&b.id).unwrap().exists());
}

#[tokio::test]
async fn unsafe_or_failed_export_keeps_profile_and_external_target() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let target = paths.profile_dir(&a.id).unwrap().join("do-not-export.sqlite");
    assert!(coordinator.delete(&a.id, &context(), Some(target)).await.is_err());
    assert_eq!(coordinator.load().profiles, vec![a.clone()]);
    #[cfg(unix)] {
        use std::os::unix::fs::symlink;
        let alias = paths.data_dir.join("alias");
        symlink(paths.profile_dir(&a.id).unwrap(), &alias).unwrap();
        assert!(coordinator.export_backup(&a.id, &alias.join("hidden.sqlite")).await.is_err());
    }
    let invalid_target = PathBuf::from("/dev/null/blocked.sqlite");
    assert!(coordinator.delete(&a.id, &context(), Some(invalid_target)).await.is_err());
    assert_eq!(coordinator.load().profiles, vec![a]);
}

#[tokio::test]
async fn delete_rename_before_registry_commit_rolls_back_on_restart() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let operation = context();
    assert!(coordinator.delete_with_failpoint(&a.id, &operation, None, DeleteFailurePoint::AfterRename).await.is_err());
    assert_eq!(coordinator.load().profiles, vec![a.clone()]);
    assert!(!paths.profile_dir(&a.id).unwrap().exists());
    drop(coordinator);
    let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
    assert_eq!(restarted.load().profiles, vec![a.clone()]);
    assert!(paths.profile_dir(&a.id).unwrap().join("notchy.db").exists());
    restarted.delete(&a.id, &operation, None).await.unwrap();
    assert!(restarted.load().profiles.is_empty());
}

#[tokio::test]
async fn export_first_delete_keeps_a_portable_copy_outside_managed_storage() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let target = paths.config_dir.parent().unwrap().join("external-export.sqlite");
    let result = coordinator.delete(&a.id, &context(), Some(target.clone())).await.unwrap();
    assert!(!result.cleanup_pending);
    assert!(target.exists());
    assert!(coordinator.load().profiles.is_empty());
    assert!(!paths.profile_dir(&a.id).unwrap().exists());
    assert!(notchy_lib::database::manifest::inspect_schema(&target).version().is_some());
}
