use std::{fs, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use crate::database::backup::export_backup_to;
use crate::database::connection::{create_dir_private, open_read_only_at, set_private_file_permissions};
use crate::database::manifest::{inspect_schema, validate_manifest, SchemaInspection};
use crate::database::migrations::now_iso_utc;
use super::coordinator::ProfileCoordinator;
use super::registry::{publish_json, read_json, sync_directory, PublishFailurePoint};
use super::types::{AppPreferences, ProfileRecord, ProfileSnapshot};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdoptionRecord { profile_id: String, phase: String, recoverable: bool }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdoptionFailurePoint { None, AfterPublish, AfterRegistry }
fn invalid() -> DbError { DbError::new(ErrorCode::DatabaseInvalid) }

fn copy_tree(source: &Path, target: &Path) -> DbResult<()> {
    create_dir_private(target).map_err(|_| invalid())?;
    for entry in fs::read_dir(source).map_err(|_| invalid())? {
        let entry = entry.map_err(|_| invalid())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&from).map_err(|_| invalid())?;
        if metadata.file_type().is_symlink() { return Err(invalid()); }
        if metadata.is_dir() { copy_tree(&from, &to)?; }
        else if metadata.is_file() {
            fs::copy(&from, &to).map_err(|_| invalid())?;
            set_private_file_permissions(&to).map_err(|_| invalid())?;
            fs::File::open(&to).and_then(|file| file.sync_all()).map_err(|_| invalid())?;
        } else { return Err(invalid()); }
    }
    sync_directory(target)
}

impl ProfileCoordinator {
    fn adoption_root(&self) -> PathBuf { self.paths.data_dir.join("profile-operations/legacy") }
    fn adoption_record_path(&self) -> PathBuf { self.adoption_root().join("adoption.json") }
    fn load_adoption(&self) -> DbResult<Option<AdoptionRecord>> {
        let Some(bytes) = read_json(&self.adoption_record_path())? else { return Ok(None) };
        let record: AdoptionRecord = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        OperationId::parse(&record.profile_id).map_err(|_| invalid())?;
        Ok(Some(record))
    }
    fn save_adoption(&self, record: &AdoptionRecord) -> DbResult<()> {
        publish_json(&self.adoption_record_path(), record, PublishFailurePoint::None)
    }
    fn legacy_locale(&self, source: &Path) -> String {
        let locale: Option<String> = open_read_only_at(source).ok().and_then(|connection| connection.query_row(
            "SELECT value FROM app_meta WHERE key = 'locale'", [], |row| row.get(0)
        ).ok());
        match locale.as_deref() { Some("vi") => "vi".into(), _ => "en".into() }
    }
    fn retire_legacy(&self) {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let path = self.paths.config_dir.join(format!("notchy.db{suffix}"));
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir_all(self.paths.data_dir.join("backups"));
    }
    pub async fn adopt_legacy(&self) -> DbResult<()> {
        self.adopt_legacy_with_failpoint(AdoptionFailurePoint::None).await
    }
    pub async fn adopt_legacy_with_failpoint(&self, failpoint: AdoptionFailurePoint) -> DbResult<()> {
        let _permit = self.transition.write().await;
        let legacy = self.paths.config_dir.join("notchy.db");
        let existing = self.load_adoption()?;
        {
            let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.registry.legacy_adopted {
                if existing.as_ref().is_some_and(|record| !record.recoverable) { self.retire_legacy(); }
                return Ok(());
            }
        }
        if !legacy.exists() && existing.is_none() { return Ok(()); }
        let mut record = match existing {
            Some(record) => record,
            None => {
                let record = AdoptionRecord { profile_id: OperationId::generate().as_str().to_owned(), phase: "prepared".into(), recoverable: false };
                self.save_adoption(&record)?;
                record
            }
        };
        let target = self.paths.profile_dir(&record.profile_id)?;
        let stage = self.adoption_root().join("staging").join(&record.profile_id);
        if !target.exists() {
            if !legacy.exists() { return Err(invalid()); }
            if stage.exists() { fs::remove_dir_all(&stage).map_err(|_| invalid())?; }
            create_dir_private(&stage).map_err(|_| invalid())?;
            let staged_db = stage.join("notchy.db");
            record.recoverable = match inspect_schema(&legacy) {
                SchemaInspection::Older { version } | SchemaInspection::Current { version } => {
                    validate_manifest(&open_read_only_at(&legacy)?, version)?;
                    export_backup_to(&legacy, &staged_db)?;
                    false
                }
                _ => {
                    fs::copy(&legacy, &staged_db).map_err(|_| invalid())?;
                    set_private_file_permissions(&staged_db).map_err(|_| invalid())?;
                    fs::File::open(&staged_db).and_then(|file| file.sync_all()).map_err(|_| invalid())?;
                    for suffix in ["-wal", "-shm", "-journal"] {
                        let from = self.paths.config_dir.join(format!("notchy.db{suffix}"));
                        if from.exists() { fs::copy(&from, stage.join(format!("notchy.db{suffix}"))).map_err(|_| invalid())?; }
                    }
                    true
                }
            };
            let old_backups = self.paths.data_dir.join("backups");
            if old_backups.exists() { copy_tree(&old_backups, &stage.join("backups"))?; }
            sync_directory(&stage)?;
            record.phase = "staged".into(); self.save_adoption(&record)?;
            let profiles_root = self.paths.data_dir.join("profiles");
            create_dir_private(&profiles_root).map_err(|_| invalid())?;
            fs::rename(&stage, &target).map_err(|_| invalid())?;
            sync_directory(&profiles_root)?;
        }
        if failpoint == AdoptionFailurePoint::AfterPublish { return Err(invalid()); }
        if !record.recoverable {
            let db = target.join("notchy.db");
            let version = match inspect_schema(&db) { SchemaInspection::Older { version } | SchemaInspection::Current { version } => version, _ => return Err(invalid()) };
            validate_manifest(&open_read_only_at(&db)?, version)?;
        }
        if self.store.load_preferences()?.is_none() {
            let preferences = AppPreferences { locale: self.legacy_locale(&legacy), theme: "light".into() };
            self.store.save_preferences(&preferences)?;
        }
        {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut next = state.registry.clone();
            if !next.profiles.iter().any(|p| p.id == record.profile_id) {
                next.profiles.push(ProfileRecord { id: record.profile_id.clone(), name: "Cá nhân".into(), created_at: now_iso_utc() });
            }
            next.last_active_id = Some(record.profile_id.clone());
            next.legacy_adopted = true;
            self.store.save(&next)?;
            state.registry = next;
        }
        if failpoint == AdoptionFailurePoint::AfterRegistry { return Err(invalid()); }
        record.phase = "committed".into(); self.save_adoption(&record)?;
        if !record.recoverable { self.retire_legacy(); }
        Ok(())
    }
    pub async fn bootstrap(&self) -> DbResult<ProfileSnapshot> {
        self.adopt_legacy().await?;
        let selected = {
            let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.active.is_some() { None } else { state.registry.last_active_id.clone() }
        };
        if let Some(id) = selected {
            if let Err(error) = self.activate(&id).await {
                if error.code != ErrorCode::ProfileNotFound {
                    self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).recovery = true;
                }
            }
        }
        Ok(self.load())
    }
}
