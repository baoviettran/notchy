use std::{fs, path::PathBuf};
use notchy_lib::database::{ErrorCode, OperationId};
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> (ProfilePaths, std::sync::Arc<ProfileCoordinator>) {
    let root = std::env::temp_dir().join(format!("notchy-profile-backup-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    (paths, coordinator)
}
fn context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None } }

#[tokio::test]
async fn restore_uses_verified_preview_and_creates_new_identity() {
    let (paths, coordinator) = fixture();
    let original = coordinator.create("Personal", &context()).await.unwrap();
    let source = paths.profile_dir(&original.id).unwrap().join("notchy.db");
    let export = paths.data_dir.parent().unwrap().join("portable.sqlite");
    coordinator.export_backup(&original.id, &export).await.unwrap();
    let source_before = fs::read(&source).unwrap();
    let preview = coordinator.inspect_restore(&export).await.unwrap();
    assert_eq!(preview.suggested_name, "Personal (2)");
    fs::write(&export, b"replaced after inspection").unwrap();
    let ctx = context();
    let restored = coordinator.restore(&preview.token, "Recovered", &ctx).await.unwrap();
    assert_ne!(restored.id, original.id);
    assert_eq!(coordinator.restore(&preview.token, "Recovered", &ctx).await.unwrap(), restored);
    assert_eq!(fs::read(&source).unwrap(), source_before);
    assert_eq!(coordinator.load().profiles.len(), 2);
    assert!(paths.profile_dir(&restored.id).unwrap().join("notchy.db").exists());
    assert!(coordinator.load().active.is_none());
}

#[tokio::test]
async fn restore_preview_suggests_a_unique_name() {
    let (paths, coordinator) = fixture();
    let original = coordinator.create("Personal", &context()).await.unwrap();
    let source = paths.data_dir.parent().unwrap().join("personal-export.sqlite");
    coordinator.export_backup(&original.id, &source).await.unwrap();
    assert_eq!(coordinator.inspect_restore(&source).await.unwrap().suggested_name, "Personal (2)");
}

#[tokio::test]
async fn create_rejects_a_restore_operation_id_even_with_the_same_name() {
    let (paths, coordinator) = fixture();
    let original = coordinator.create("Personal", &context()).await.unwrap();
    let source = paths.profile_dir(&original.id).unwrap().join("notchy.db");
    let preview = coordinator.inspect_restore(&source).await.unwrap();
    let ctx = context();
    coordinator.restore(&preview.token, "Restored", &ctx).await.unwrap();
    assert_eq!(coordinator.create("Restored", &ctx).await.unwrap_err().code, ErrorCode::OperationIdConflict);
}

#[tokio::test]
async fn rejects_invalid_sources_without_registering_a_profile() {
    let (paths, coordinator) = fixture();
    for (name, bytes) in [("corrupt", b"not sqlite".as_slice()), ("empty", b"".as_slice())] {
        let file = paths.data_dir.join(name);
        fs::create_dir_all(&paths.data_dir).unwrap();
        fs::write(&file, bytes).unwrap();
        assert!(coordinator.inspect_restore(&file).await.is_err());
    }
    assert!(coordinator.load().profiles.is_empty());
}

#[tokio::test]
async fn cancel_removes_preview_and_blocks_restore() {
    let (paths, coordinator) = fixture();
    let original = coordinator.create("A", &context()).await.unwrap();
    let source = paths.profile_dir(&original.id).unwrap().join("notchy.db");
    let preview = coordinator.inspect_restore(&source).await.unwrap();
    coordinator.cancel_restore(&preview.token).await.unwrap();
    assert_eq!(coordinator.restore(&preview.token, "B", &context()).await.unwrap_err().code, ErrorCode::InvalidInput);
    assert_eq!(coordinator.load().profiles.len(), 1);
}

#[tokio::test]
async fn compatible_older_backup_is_migrated_without_mutating_source() {
    let (paths, coordinator) = fixture();
    fs::create_dir_all(&paths.data_dir).unwrap();
    let source = paths.data_dir.join("older.sqlite");
    fs::copy(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/v004.sqlite"), &source).unwrap();
    let before = fs::read(&source).unwrap();
    let preview = coordinator.inspect_restore(&source).await.unwrap();
    assert_eq!(preview.suggested_name, "older");
    let restored = coordinator.restore(&preview.token, "Older", &context()).await.unwrap();
    assert_eq!(fs::read(&source).unwrap(), before);
    assert!(paths.profile_dir(&restored.id).unwrap().join("notchy.db").exists());
}

#[tokio::test]
async fn newer_backup_is_rejected_without_changing_registry() {
    let (paths, coordinator) = fixture();
    fs::create_dir_all(&paths.data_dir).unwrap();
    let source = paths.data_dir.join("newer.sqlite");
    fs::copy(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/v008.sqlite"), &source).unwrap();
    assert!(coordinator.inspect_restore(&source).await.is_err());
    assert!(coordinator.load().profiles.is_empty());
}

#[tokio::test]
async fn operation_id_cannot_restore_a_different_preview() {
    let (paths, coordinator) = fixture();
    let original = coordinator.create("A", &context()).await.unwrap();
    let source = paths.profile_dir(&original.id).unwrap().join("notchy.db");
    let first = coordinator.inspect_restore(&source).await.unwrap();
    let second = coordinator.inspect_restore(&source).await.unwrap();
    let ctx = context();
    coordinator.restore(&first.token, "Restored", &ctx).await.unwrap();
    assert_eq!(coordinator.restore(&second.token, "Restored", &ctx).await.unwrap_err().code, ErrorCode::OperationIdConflict);
    assert_eq!(coordinator.load().profiles.len(), 2);
}

#[tokio::test]
async fn failed_export_preserves_existing_target_and_other_profiles() {
    use notchy_lib::database::BackupFailurePoint;
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    let b_source = paths.profile_dir(&b.id).unwrap().join("notchy.db");
    let b_before = fs::read(&b_source).unwrap();
    let target = paths.data_dir.parent().unwrap().join("saved.sqlite");
    fs::write(&target, b"old export").unwrap();
    assert!(coordinator.export_backup_with_failpoint(&a.id, &target, BackupFailurePoint::AfterCopy).await.is_err());
    assert_eq!(fs::read(&target).unwrap(), b"old export");
    assert_eq!(fs::read(&b_source).unwrap(), b_before);
    assert_eq!(coordinator.load().profiles.len(), 2);
}

#[tokio::test]
async fn internal_backup_is_scoped_to_its_profile_and_preserves_preferences() {
    use notchy_lib::profiles::registry::RegistryStore;
    use notchy_lib::profiles::types::AppPreferences;
    let (paths, coordinator) = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    let preferences = AppPreferences { locale: "vi".into(), theme: "dark".into() };
    RegistryStore::new(paths.clone()).save_preferences(&preferences).unwrap();
    let source = paths.profile_dir(&a.id).unwrap().join("notchy.db");
    let before = fs::read(&source).unwrap();
    coordinator.backup(&a.id).await.unwrap();
    assert_eq!(coordinator.backups(&a.id).await.unwrap().len(), 1);
    assert!(coordinator.backups(&b.id).await.unwrap().is_empty());
    assert_eq!(fs::read(&source).unwrap(), before);
    let file = paths.profile_dir(&a.id).unwrap().join("backups");
    let backup = fs::read_dir(file).unwrap().next().unwrap().unwrap().path();
    let preview = coordinator.inspect_restore(&backup).await.unwrap();
    coordinator.restore(&preview.token, "A restored", &context()).await.unwrap();
    assert_eq!(RegistryStore::new(paths).load_preferences().unwrap(), Some(preferences));
}
