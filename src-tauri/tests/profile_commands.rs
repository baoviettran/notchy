use notchy_lib::database::{ErrorCode, OperationId};
use notchy_lib::profiles::commands::{authorize_profile_mutation, ProfileStoragePaths};
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> std::sync::Arc<ProfileCoordinator> {
    let root = std::env::temp_dir().join(format!("notchy-profile-command-{}", OperationId::generate().as_str()));
    ProfileCoordinator::open(ProfilePaths::new(root.join("config"), root.join("data"))).unwrap()
}
fn context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None } }

#[test]
fn main_only_mutations_reject_quick_add_and_unknown_windows() {
    assert!(authorize_profile_mutation("main").is_ok());
    assert_eq!(authorize_profile_mutation("quick-add").unwrap_err().code, ErrorCode::UnauthorizedCaller);
    assert_eq!(authorize_profile_mutation("other").unwrap_err().code, ErrorCode::UnauthorizedCaller);
}

#[tokio::test]
async fn paths_are_derived_from_registered_id_and_active_reset_needs_a_token() {
    let coordinator = fixture();
    let record = coordinator.create("A", &context()).await.unwrap();
    let paths = ProfileStoragePaths::for_profile(&coordinator, &record.id).unwrap();
    assert!(paths.database_path.ends_with(format!("{}/notchy.db", record.id).as_str()));
    assert!(ProfileStoragePaths::for_profile(&coordinator, "../outside").is_err());
    coordinator.activate(&record.id).await.unwrap();
    assert_eq!(coordinator.reset(&record.id, &context()).await.unwrap_err().code, ErrorCode::ProfileTransitionBlocked);
    let stale = notchy_lib::profiles::types::ProfileSession { profile_id: record.id.clone(), generation: OperationId::generate().as_str().to_owned() };
    assert_eq!(coordinator.with_session(&stale, |_state| Ok(())).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
}

#[test]
fn profile_errors_have_stable_snake_case_contracts() {
    assert_eq!(serde_json::to_value(ErrorCode::ProfileNameInvalid).unwrap(), "profile_name_invalid");
    assert_eq!(serde_json::to_value(ErrorCode::ProfileSessionExpired).unwrap(), "profile_session_expired");
    assert_eq!(serde_json::to_value(ErrorCode::ProfileExportUnsafe).unwrap(), "profile_export_unsafe");
}

#[tokio::test]
async fn actual_tauri_command_guard_uses_sender_window_label() {
    use tauri::Manager;
    use notchy_lib::profiles::commands::{profile_create, profile_paths};
    let coordinator = fixture();
    let app = tauri::test::mock_builder()
        .manage(coordinator)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let quick = tauri::WebviewWindowBuilder::new(&app, "quick-add", Default::default()).build().unwrap();
    assert_eq!(profile_create(quick.clone(), app.state(), "A".into(), context()).await.unwrap_err().code, ErrorCode::UnauthorizedCaller);
    let created = profile_create(main, app.state(), "A".into(), context()).await.unwrap();
    assert!(profile_paths(app.state(), created.id).is_ok());
}
