use std::{fs, path::PathBuf};
use notchy_lib::database::OperationId;
use notchy_lib::profiles::coordinator::ProfileCoordinator;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::types::OperationContext;

fn fixture() -> (ProfilePaths, std::sync::Arc<ProfileCoordinator>) {
    let root = std::env::temp_dir().join(format!("notchy-profile-legacy-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    (paths, coordinator)
}
fn context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().to_owned(), transition_token: None } }
fn old_fixture() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/v004.sqlite") }

#[tokio::test]
async fn adopts_legacy_database_backup_and_locale_once() {
    let (paths, coordinator) = fixture();
    let legacy = paths.config_dir.join("notchy.db");
    fs::copy(old_fixture(), &legacy).unwrap();
    let connection = rusqlite::Connection::open(&legacy).unwrap();
    connection.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('locale', 'vi')", []).unwrap();
    drop(connection);
    let backups = paths.data_dir.join("backups");
    fs::create_dir_all(backups.join("upgrades")).unwrap();
    let backup = backups.join("upgrades/old.sqlite");
    fs::copy(old_fixture(), &backup).unwrap();
    let backup_bytes = fs::read(&backup).unwrap();
    let snapshot = coordinator.bootstrap().await.unwrap();
    assert_eq!(snapshot.profiles.len(), 1);
    assert_eq!(snapshot.profiles[0].name, "Cá nhân");
    assert_eq!(snapshot.preferences.locale, "vi");
    assert_eq!(snapshot.active.as_ref().unwrap().profile_id, snapshot.profiles[0].id);
    assert!(snapshot.profiles.len() == 1);
    let new_backup = paths.profile_dir(&snapshot.profiles[0].id).unwrap().join("backups/upgrades/old.sqlite");
    assert_eq!(fs::read(new_backup).unwrap(), backup_bytes);
    drop(coordinator);
    let reopened = ProfileCoordinator::open(paths.clone()).unwrap();
    assert_eq!(reopened.bootstrap().await.unwrap().profiles.len(), 1);
}

#[tokio::test]
async fn corrupt_legacy_database_is_registered_for_recovery_with_backups() {
    let (paths, coordinator) = fixture();
    fs::write(paths.config_dir.join("notchy.db"), b"corrupt legacy data").unwrap();
    let backups = paths.data_dir.join("backups");
    fs::create_dir_all(&backups).unwrap();
    fs::copy(old_fixture(), backups.join("backup.sqlite")).unwrap();
    let snapshot = coordinator.bootstrap().await.unwrap();
    assert_eq!(snapshot.profiles.len(), 1);
    assert!(snapshot.active.is_none());
    assert_eq!(snapshot.phase, "recovery");
    let new_dir = paths.profile_dir(&snapshot.profiles[0].id).unwrap();
    assert_eq!(fs::read(new_dir.join("notchy.db")).unwrap(), b"corrupt legacy data");
    assert!(new_dir.join("backups/backup.sqlite").exists());
    assert_eq!(fs::read(paths.config_dir.join("notchy.db")).unwrap(), b"corrupt legacy data");
}

#[tokio::test]
async fn deleting_last_adopted_profile_never_recreates_it_from_leftover_legacy_files() {
    let (paths, coordinator) = fixture();
    fs::copy(old_fixture(), paths.config_dir.join("notchy.db")).unwrap();
    let snapshot = coordinator.bootstrap().await.unwrap();
    let id = snapshot.profiles[0].id.clone();
    let context = OperationContext { operation_id: context().operation_id, transition_token: Some(coordinator.issue_transition_token()) };
    coordinator.delete(&id, &context, None).await.unwrap();
    fs::copy(old_fixture(), paths.config_dir.join("notchy.db")).unwrap();
    assert!(coordinator.bootstrap().await.unwrap().profiles.is_empty());
    drop(coordinator);
    let reopened = ProfileCoordinator::open(paths).unwrap();
    assert!(reopened.bootstrap().await.unwrap().profiles.is_empty());
}

#[tokio::test]
async fn fresh_install_stays_empty_and_corrupt_registry_blocks_adoption() {
    let (paths, coordinator) = fixture();
    assert!(coordinator.bootstrap().await.unwrap().profiles.is_empty());
    drop(coordinator);
    fs::copy(old_fixture(), paths.config_dir.join("notchy.db")).unwrap();
    fs::write(paths.registry_file(), b"broken registry").unwrap();
    assert!(ProfileCoordinator::open(paths).is_err());
}

#[tokio::test]
async fn interrupted_adoption_reuses_one_identity_before_and_after_registry_commit() {
    use notchy_lib::profiles::legacy::AdoptionFailurePoint;
    for point in [AdoptionFailurePoint::AfterPublish, AdoptionFailurePoint::AfterRegistry] {
        let (paths, coordinator) = fixture();
        fs::copy(old_fixture(), paths.config_dir.join("notchy.db")).unwrap();
        assert!(coordinator.adopt_legacy_with_failpoint(point).await.is_err());
        drop(coordinator);
        let restarted = ProfileCoordinator::open(paths.clone()).unwrap();
        let snapshot = restarted.bootstrap().await.unwrap();
        assert_eq!(snapshot.profiles.len(), 1);
        let id = snapshot.profiles[0].id.clone();
        assert!(paths.profile_dir(&id).unwrap().join("notchy.db").exists());
        assert_eq!(restarted.bootstrap().await.unwrap().profiles[0].id, id);
    }
}

#[tokio::test]
async fn adopts_uncheckpointed_legacy_wal_rows() {
    use notchy_lib::database::{bootstrap_current, FailurePoint};
    let (paths, coordinator) = fixture();
    let legacy = paths.config_dir.join("notchy.db");
    bootstrap_current(&legacy, FailurePoint::None).unwrap();
    let connection = rusqlite::Connection::open(&legacy).unwrap();
    connection.pragma_update(None, "journal_mode", "WAL").unwrap();
    connection.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('currency', 'USD')", []).unwrap();
    let snapshot = coordinator.bootstrap().await.unwrap();
    let adopted = paths.profile_dir(&snapshot.profiles[0].id).unwrap().join("notchy.db");
    let copied = rusqlite::Connection::open(adopted).unwrap();
    let currency: String = copied.query_row("SELECT value FROM app_meta WHERE key = 'currency'", [], |row| row.get(0)).unwrap();
    assert_eq!(currency, "USD");
}

#[tokio::test]
async fn existing_application_preferences_win_over_legacy_locale() {
    use notchy_lib::profiles::registry::RegistryStore;
    use notchy_lib::profiles::types::AppPreferences;
    let (paths, coordinator) = fixture();
    let legacy = paths.config_dir.join("notchy.db");
    fs::copy(old_fixture(), &legacy).unwrap();
    rusqlite::Connection::open(&legacy).unwrap().execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('locale', 'vi')", []).unwrap();
    let preferences = AppPreferences { locale: "en".into(), theme: "dark".into() };
    RegistryStore::new(paths).save_preferences(&preferences).unwrap();
    assert_eq!(coordinator.bootstrap().await.unwrap().preferences, preferences);
}

#[tokio::test]
async fn stale_saved_selection_opens_picker_without_recovery() {
    use notchy_lib::profiles::registry::RegistryStore;
    use notchy_lib::profiles::types::ProfileRegistry;
    let (paths, coordinator) = fixture();
    drop(coordinator);
    let missing = OperationId::generate().as_str().to_owned();
    RegistryStore::new(paths.clone()).save(&ProfileRegistry {
        version: 1, profiles: vec![], last_active_id: Some(missing), legacy_adopted: true,
    }).unwrap();
    let coordinator = ProfileCoordinator::open(paths).unwrap();
    let snapshot = coordinator.bootstrap().await.unwrap();
    assert!(snapshot.active.is_none());
    assert_eq!(snapshot.phase, "idle");
    assert!(snapshot.recovery.is_none());
}

#[tokio::test]
async fn selected_profile_with_missing_database_enters_recovery_without_creating_data() {
    let (paths, coordinator) = fixture();
    let record = coordinator.create("Personal", &context()).await.unwrap();
    coordinator.activate(&record.id).await.unwrap();
    let db = paths.profile_dir(&record.id).unwrap().join("notchy.db");
    drop(coordinator);
    fs::remove_file(&db).unwrap();
    let restarted = ProfileCoordinator::open(paths).unwrap();
    let snapshot = restarted.bootstrap().await.unwrap();
    assert!(snapshot.active.is_none());
    assert_eq!(snapshot.phase, "recovery");
    assert_eq!(snapshot.recovery.unwrap().profile_id.as_deref(), Some(record.id.as_str()));
    assert!(!db.exists());
}
