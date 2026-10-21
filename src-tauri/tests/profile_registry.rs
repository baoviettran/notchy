use std::fs;
use notchy_lib::profiles::paths::ProfilePaths;
use notchy_lib::profiles::registry::{RegistryStore, PublishFailurePoint};
use notchy_lib::profiles::types::{AppPreferences, ProfileRecord, ProfileRegistry, validate_name};
use notchy_lib::database::OperationId;

fn fixture() -> (ProfilePaths, RegistryStore) {
    let root = std::env::temp_dir().join(format!("notchy-profiles-registry-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let store = RegistryStore::new(paths.clone());
    (paths, store)
}

fn profile(id: &str, name: &str) -> ProfileRecord {
    ProfileRecord { id: id.to_owned(), name: name.to_owned(), created_at: "2026-10-19T00:00:00Z".to_owned() }
}

#[test]
fn missing_registry_is_empty_but_corrupt_registry_is_an_error() {
    let (paths, store) = fixture();
    assert!(store.load().unwrap().profiles.is_empty());
    fs::create_dir_all(&paths.config_dir).unwrap();
    fs::write(paths.registry_file(), b"{broken").unwrap();
    assert!(store.load().is_err());
}

#[test]
fn registry_keeps_distinct_ids_even_when_names_match() {
    let (paths, store) = fixture();
    let first = OperationId::generate().as_str().to_owned();
    let second = OperationId::generate().as_str().to_owned();
    let registry = ProfileRegistry { version: 1, profiles: vec![profile(&first, "Cá nhân"), profile(&second, "Cá nhân")], last_active_id: Some(first.clone()), legacy_adopted: false };
    store.save(&registry).unwrap();
    assert_eq!(store.load().unwrap(), registry);
    assert_eq!(paths.profile_dir(&second).unwrap(), paths.data_dir.join("profiles").join(second));
    assert!(paths.profile_dir("../elsewhere").is_err());
    assert!(paths.profile_dir("not-a-ulid").is_err());
    let invalid = ProfileRegistry { profiles: vec![profile(&first, "A"), profile(&first, "B")], ..registry };
    assert!(store.save(&invalid).is_err());
}

#[test]
fn name_validation_counts_unicode_characters_and_trims_space() {
    assert_eq!(validate_name("  Cá nhân  ").unwrap(), "Cá nhân");
    assert!(validate_name("   ").is_err());
    assert!(validate_name(&"😀".repeat(80)).is_ok());
    assert!(validate_name(&"😀".repeat(81)).is_err());
}

#[test]
fn failed_publication_preserves_previous_registry_bytes() {
    let (paths, store) = fixture();
    let first = ProfileRegistry { version: 1, profiles: vec![profile(OperationId::generate().as_str(), "A")], last_active_id: None, legacy_adopted: false };
    store.save(&first).unwrap();
    let before = fs::read(paths.registry_file()).unwrap();
    let changed = ProfileRegistry { profiles: vec![profile(OperationId::generate().as_str(), "B")], ..first.clone() };
    assert!(store.save_with_failpoint(&changed, PublishFailurePoint::BeforeRename).is_err());
    assert_eq!(fs::read(paths.registry_file()).unwrap(), before);
    assert_eq!(store.load().unwrap(), first);
}

#[test]
fn preferences_do_not_change_when_registry_changes() {
    let (_, store) = fixture();
    let preferences = AppPreferences { locale: "vi".into(), theme: "dark".into() };
    store.save_preferences(&preferences).unwrap();
    store.save(&ProfileRegistry::empty()).unwrap();
    assert_eq!(store.load_preferences().unwrap(), Some(preferences));
}

#[cfg(unix)]
#[test]
fn registry_files_and_directories_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let (paths, store) = fixture();
    store.save(&ProfileRegistry::empty()).unwrap();
    let dir_mode = fs::metadata(&paths.config_dir).unwrap().permissions().mode() & 0o777;
    let file_mode = fs::metadata(paths.registry_file()).unwrap().permissions().mode() & 0o777;
    assert_eq!(dir_mode, 0o700);
    assert_eq!(file_mode, 0o600);
}
