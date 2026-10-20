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
