use std::fs;
use notchy_lib::database::{OperationId, ErrorCode};
use notchy_lib::database::manifest::{inspect_schema, SchemaInspection};
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::create::CreateFailurePoint;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> (ProfilePaths, std::sync::Arc<ProfileCoordinator>) {
    let root = std::env::temp_dir().join(format!("notchy-profile-lifecycle-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    (paths, coordinator)
}

fn context() -> OperationContext {
    OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None }
}

#[tokio::test]
async fn create_publishes_two_distinct_seeded_profiles() {
    let (paths, coordinator) = fixture();
    let a = coordinator.create("  Cá nhân  ", &context()).await.unwrap();
    let b = coordinator.create("Thử nghiệm", &context()).await.unwrap();
    assert_ne!(a.id, b.id);
    assert_eq!(a.name, "Cá nhân");
    assert_eq!(coordinator.load().profiles.len(), 2);
    for record in [&a, &b] {
        let db = paths.profile_dir(&record.id).unwrap().join("notchy.db");
        assert!(matches!(inspect_schema(&db), SchemaInspection::Current { .. }));
    }
}

#[tokio::test]
async fn rename_keeps_database_bytes_and_identity() {
    let (paths, coordinator) = fixture();
    let record = coordinator.create("Original", &context()).await.unwrap();
    let db = paths.profile_dir(&record.id).unwrap().join("notchy.db");
    let before = blake3::hash(&fs::read(&db).unwrap());
    let renamed = coordinator.rename(&record.id, "  New name  ").await.unwrap();
    assert_eq!(renamed.id, record.id);
    assert_eq!(renamed.name, "New name");
    assert_eq!(blake3::hash(&fs::read(&db).unwrap()), before);
}

#[tokio::test]
async fn duplicate_operation_returns_one_profile_and_conflicting_payload_fails() {
    let (_, coordinator) = fixture();
    let ctx = context();
    let first = coordinator.create("A", &ctx).await.unwrap();
    assert_eq!(coordinator.create("A", &ctx).await.unwrap(), first);
    assert_eq!(coordinator.load().profiles.len(), 1);
    assert_eq!(coordinator.create("B", &ctx).await.unwrap_err().code, ErrorCode::OperationIdConflict);
}

#[tokio::test]
async fn published_directory_replays_once_after_interruption() {
    let (paths, coordinator) = fixture();
    let ctx = context();
    assert!(coordinator.create_with_failpoint("A", &ctx, CreateFailurePoint::AfterPublish).await.is_err());
    assert!(coordinator.load().profiles.is_empty());
    drop(coordinator);
    let restarted = ProfileCoordinator::open(paths).unwrap();
    restarted.reconcile_operations().unwrap();
    assert_eq!(restarted.load().profiles.len(), 1);
    assert_eq!(restarted.create("A", &ctx).await.unwrap().id, restarted.load().profiles[0].id);
}

#[tokio::test]
async fn failed_staging_does_not_publish_a_partial_profile() {
    let (paths, coordinator) = fixture();
    let ctx = context();
    assert!(coordinator.create_with_failpoint("A", &ctx, CreateFailurePoint::BeforePublish).await.is_err());
    assert!(coordinator.load().profiles.is_empty());
    assert!(!paths.data_dir.join("profiles").exists() || fs::read_dir(paths.data_dir.join("profiles")).unwrap().next().is_none());
}
