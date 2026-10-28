//! Production profile command guards. Legacy single-database lifecycle calls
//! fail closed; financial commands require the active profile generation.
use std::sync::Arc;
use tauri::Manager;
use notchy_lib::database::{commands, ErrorCode, OperationId};
use notchy_lib::database::commands::{account_list, backup_create, database_import, database_initialize};
use notchy_lib::profiles::commands::profiles_bootstrap;
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> Arc<ProfileCoordinator> {
    let root = std::env::temp_dir().join(format!("notchy-command-guards-{}", OperationId::generate().as_str()));
    ProfileCoordinator::open(ProfilePaths::new(root.join("config"), root.join("data"))).unwrap()
}
fn context() -> OperationContext {
    OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None }
}

#[tokio::test]
async fn only_main_window_can_bootstrap_profiles() {
    let app = tauri::test::mock_builder().manage(fixture())
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let quick = tauri::WebviewWindowBuilder::new(&app, "quick-add", Default::default()).build().unwrap();
    let error = profiles_bootstrap(quick, app.state()).await.unwrap_err();
    assert_eq!(error.code, ErrorCode::UnauthorizedCaller);
    let snapshot = profiles_bootstrap(main, app.state()).await.unwrap();
    assert!(snapshot.profiles.is_empty());
    assert!(snapshot.active.is_none());
}

#[tokio::test]
async fn stale_generation_cannot_read_or_back_up_another_profile() {
    let coordinator = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let b = coordinator.create("B", &context()).await.unwrap();
    let old = coordinator.activate(&a.id).await.unwrap();
    let app = tauri::test::mock_builder().manage(Arc::clone(&coordinator))
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    coordinator.activate(&b.id).await.unwrap();
    assert_eq!(account_list(app.state(), old.clone()).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
    assert_eq!(commands::backup_automatic_status(app.state(), old.clone()).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
    assert_eq!(commands::backup_automatic_check(app.state(), old.clone()).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
    assert_eq!(commands::backup_automatic_set_enabled(app.state(), old.clone(), false, OperationId::generate()).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
    assert_eq!(backup_create(app.state(), old).await.unwrap_err().code, ErrorCode::ProfileSessionExpired);
}

#[tokio::test]
async fn obsolete_import_and_initialize_fail_closed() {
    let app = tauri::test::mock_builder().manage(fixture())
        .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
    assert_eq!(database_initialize(app.state()).await.unwrap_err().code, ErrorCode::InvalidInput);
    assert_eq!(database_import(app.state(), "/missing.sqlite".into()).await.unwrap_err().code, ErrorCode::InvalidInput);
}
