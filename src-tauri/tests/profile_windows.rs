use notchy_lib::database::{ErrorCode, OperationId};
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> std::sync::Arc<ProfileCoordinator> {
    let root = std::env::temp_dir().join(format!("notchy-profile-window-{}", OperationId::generate().as_str()));
    ProfileCoordinator::open(ProfilePaths::new(root.join("config"), root.join("data"))).unwrap()
}
fn context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None } }

#[tokio::test]
async fn hidden_dirty_quick_add_and_nonresponsive_window_block_token() {
    let coordinator = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let session = coordinator.activate(&a.id).await.unwrap();
    let request = coordinator.prepare_transition(Some(session), vec!["main".into(), "quick-add".into()]).unwrap();
    assert!(coordinator.ack_transition(&request.request_id, "main", false, true).unwrap().is_none());
    assert!(coordinator.ack_transition(&request.request_id, "quick-add", true, false).unwrap().is_none());
    assert!(coordinator.transition_token(&request.request_id).is_none());
    assert!(coordinator.ack_transition(&request.request_id, "quick-add", true, true).unwrap().is_some());
    assert!(coordinator.ack_transition(&request.request_id, "quick-add", false, true).unwrap().is_none());
}

#[tokio::test]
async fn canceled_request_and_changed_session_cannot_authorize_transition() {
    let coordinator = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let session = coordinator.activate(&a.id).await.unwrap();
    let request = coordinator.prepare_transition(Some(session.clone()), vec!["main".into()]).unwrap();
    coordinator.cancel_transition(&request.request_id).unwrap();
    assert!(coordinator.ack_transition(&request.request_id, "main", false, true).is_err());
    let request = coordinator.prepare_transition(Some(session.clone()), vec!["main".into()]).unwrap();
    let token = coordinator.ack_transition(&request.request_id, "main", false, true).unwrap().unwrap();
    let invalid = coordinator.activate_with_token(&a.id, Some(&token)).await.unwrap();
    assert_ne!(invalid.generation, session.generation);
    assert_eq!(coordinator.reset(&a.id, &OperationContext { operation_id: context().operation_id, transition_token: Some(token) }).await.unwrap_err().code, ErrorCode::ProfileTransitionBlocked);
}

#[tokio::test]
async fn closed_quick_add_is_removed_from_pending_participants() {
    let coordinator = fixture();
    let request = coordinator.prepare_transition(None, vec!["main".into(), "quick-add".into()]).unwrap();
    assert!(coordinator.ack_transition(&request.request_id, "main", false, true).unwrap().is_none());
    assert!(coordinator.window_closed("quick-add").is_some());
}

#[tokio::test]
async fn late_edit_or_new_window_revokes_an_issued_token() {
    let coordinator = fixture();
    let a = coordinator.create("A", &context()).await.unwrap();
    let active = coordinator.activate(&a.id).await.unwrap();
    let request = coordinator.prepare_transition(Some(active), vec!["main".into()]).unwrap();
    let token = coordinator.ack_transition(&request.request_id, "main", false, true).unwrap().unwrap();
    assert!(coordinator.window_opened("quick-add").is_some());
    assert!(coordinator.ack_transition(&request.request_id, "quick-add", true, false).unwrap().is_none());
    assert_eq!(coordinator.reset(&a.id, &OperationContext { operation_id: context().operation_id, transition_token: Some(token) }).await.unwrap_err().code, ErrorCode::ProfileTransitionBlocked);
    assert!(coordinator.ack_transition(&request.request_id, "quick-add", true, true).unwrap().is_some());
    let token = coordinator.transition_token(&request.request_id).unwrap();
    coordinator.ack_transition(&request.request_id, "main", true, false).unwrap();
    assert_eq!(coordinator.reset(&a.id, &OperationContext { operation_id: context().operation_id, transition_token: Some(token) }).await.unwrap_err().code, ErrorCode::ProfileTransitionBlocked);
}

#[tokio::test]
async fn successful_transition_clears_pending_request_for_the_next_change() {
    let coordinator = fixture();
    let request = coordinator.prepare_transition(None, vec!["main".into()]).unwrap();
    assert!(coordinator.ack_transition(&request.request_id, "main", false, true).unwrap().is_some());
    coordinator.finish_transition();
    assert!(coordinator.prepare_transition(None, vec!["main".into()]).is_ok());
}
