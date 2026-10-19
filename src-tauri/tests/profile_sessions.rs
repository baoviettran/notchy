use std::sync::Arc;
use std::time::Duration;
use notchy_lib::database::{DbError, ErrorCode, ProcessLock};
use rusqlite::OptionalExtension;
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::registry::RegistryStore;
use notchy_lib::profiles::types::{ProfileRecord, ProfileRegistry};
use notchy_lib::database::OperationId;

fn fixture() -> (ProfilePaths, String, String) {
    let root = std::env::temp_dir().join(format!("notchy-profile-session-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let a = OperationId::generate().as_str().to_owned();
    let b = OperationId::generate().as_str().to_owned();
    let records = [&a, &b].into_iter().map(|id| ProfileRecord {
        id: id.to_owned(), name: id.to_owned(), created_at: "2026-10-19T00:00:00Z".into()
    }).collect();
    RegistryStore::new(paths.clone()).save(&ProfileRegistry { version: 1, profiles: records, last_active_id: None, legacy_adopted: false }).unwrap();
    (paths, a, b)
}

#[test]
fn application_lock_survives_an_empty_profile_list() {
    let root = std::env::temp_dir().join(format!("notchy-profile-empty-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    assert!(coordinator.load().profiles.is_empty());
    assert_eq!(ProcessLock::acquire(&paths.config_dir.join("notchy.lock")).err().unwrap().code, ErrorCode::DatabaseLocked);
    drop(coordinator);
    assert!(ProcessLock::acquire(&paths.config_dir.join("notchy.lock")).is_ok());
}

#[tokio::test]
async fn accepted_work_finishes_in_a_before_switching_to_b() {
    let (paths, a, b) = fixture();
    let coordinator = ProfileCoordinator::open(paths).unwrap();
    let a_session = coordinator.activate(&a).await.unwrap();
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let worker = {
        let coordinator = Arc::clone(&coordinator);
        let session = a_session.clone();
        tokio::spawn(async move {
            coordinator.with_session(&session, move |state| {
                let _ = entered_tx.send(());
                release_rx.recv().unwrap();
                state.connection()?.execute("INSERT OR REPLACE INTO app_meta(key,value) VALUES('profile_test','A')", []).unwrap();
                Ok(())
            }).await
        })
    };
    entered_rx.await.unwrap();
    let switch = {
        let coordinator = Arc::clone(&coordinator);
        tokio::spawn(async move { coordinator.activate(&b).await })
    };
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!switch.is_finished());
    release_tx.send(()).unwrap();
    worker.await.unwrap().unwrap();
    let b_session = switch.await.unwrap().unwrap();
    assert_eq!(coordinator.load().active.unwrap(), b_session);
    assert!(coordinator.with_session(&a_session, |_state| Ok(())).await.is_err());
    let b_marker: Option<String> = coordinator.with_session(&b_session, |state| {
        state.connection()?.query_row("SELECT value FROM app_meta WHERE key='profile_test'", [], |row| row.get(0)).optional().map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))
    }).await.unwrap();
    assert_eq!(b_marker, None);
}

#[tokio::test]
async fn failed_activation_reopens_original_and_keeps_selection() {
    let (paths, a, b) = fixture();
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let first = coordinator.activate(&a).await.unwrap();
    let b_dir = paths.profile_dir(&b).unwrap();
    std::fs::create_dir_all(&b_dir).unwrap();
    std::fs::write(b_dir.join("notchy.db"), b"broken sqlite").unwrap();
    assert!(coordinator.activate(&b).await.is_err());
    let recovered = coordinator.load().active.unwrap();
    assert_eq!(recovered.profile_id, a);
    assert_ne!(recovered.generation, first.generation);
    assert_eq!(coordinator.load().profiles.len(), 2);
    assert!(coordinator.with_session(&recovered, |_state| Ok(())).await.is_ok());
}

#[tokio::test]
async fn failed_destination_and_failed_rollback_leave_no_writable_session() {
    let (paths, a, b) = fixture();
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let old = coordinator.activate(&a).await.unwrap();
    let b_dir = paths.profile_dir(&b).unwrap();
    std::fs::create_dir_all(&b_dir).unwrap();
    std::fs::write(b_dir.join("notchy.db"), b"broken sqlite").unwrap();
    let a_dir = paths.profile_dir(&a).unwrap();
    std::fs::write(a_dir.join("notchy.db"), b"broken sqlite").unwrap();
    assert!(coordinator.activate(&b).await.is_err());
    assert_eq!(coordinator.load().phase, "recovery");
    assert!(coordinator.load().active.is_none());
    assert!(coordinator.with_session(&old, |_state| Ok(())).await.is_err());
}
