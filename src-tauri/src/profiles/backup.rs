use std::{fs, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::database::{BackupFailurePoint, BackupSummary, BackupToken, DbError, DbResult, ErrorCode, OperationId};
use crate::database::backup::{discover_verified_backups, export_backup_to, export_backup_to_at, publish_backup};
use crate::database::connection::{create_dir_private, open_live_at, open_read_only_at};
use crate::database::manifest::{inspect_schema, validate_manifest, SchemaInspection};
use crate::database::migrations::{migrate_supported, now_iso_utc, FailurePoint, LATEST_SCHEMA_VERSION};
use super::coordinator::ProfileCoordinator;
use super::journal::{JournalPhase, JournalRecord, JournalStore};
use super::types::{OperationContext, ProfileRecord, validate_name};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub token: String,
    pub suggested_name: String,
    pub schema_version: i64,
}

pub(super) struct PreviewEntry { pub path: PathBuf, pub digest: blake3::Hash }

fn invalid() -> DbError { DbError::new(ErrorCode::DatabaseInvalid) }
fn preview_digest(path: &Path) -> DbResult<blake3::Hash> {
    Ok(blake3::hash(&fs::read(path).map_err(|_| invalid())?))
}
fn validate_compatible(path: &Path) -> DbResult<i64> {
    let version = match inspect_schema(path) {
        SchemaInspection::Older { version } | SchemaInspection::Current { version } => version,
        SchemaInspection::TooOld { .. } => return Err(DbError::new(ErrorCode::SchemaTooOld)),
        SchemaInspection::Newer { .. } => return Err(DbError::new(ErrorCode::SchemaTooNew)),
        _ => return Err(invalid()),
    };
    validate_manifest(&open_read_only_at(path)?, version)?;
    Ok(version)
}

impl ProfileCoordinator {
    fn preview_root(&self) -> PathBuf { self.paths.data_dir.join("profile-operations/previews") }

    pub(super) fn profile_source(&self, id: &str) -> DbResult<PathBuf> {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !state.registry.profiles.iter().any(|profile| profile.id == id) { return Err(DbError::new(ErrorCode::ProfileNotFound)); }
        Ok(self.paths.profile_dir(id)?.join("notchy.db"))
    }

    pub(super) fn labeled_snapshot(&self, id: &str) -> DbResult<PathBuf> {
        let source = self.profile_source(id)?;
        validate_compatible(&source)?;
        let name = {
            let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            state.registry.profiles.iter().find(|p| p.id == id).ok_or_else(invalid)?.name.clone()
        };
        let root = self.preview_root();
        create_dir_private(&root).map_err(|_| invalid())?;
        let snapshot = root.join(format!("label-{}.sqlite", OperationId::generate().as_str()));
        export_backup_to(&source, &snapshot)?;
        let result = (|| -> DbResult<()> {
            let connection = open_live_at(&snapshot)?;
            connection.execute("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('profile_display_name', ?1)", [&name]).map_err(|_| invalid())?;
            drop(connection);
            validate_compatible(&snapshot)?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(&snapshot); }
        result.map(|()| snapshot)
    }

    pub async fn backups(&self, id: &str) -> DbResult<Vec<BackupSummary>> {
        let _permit = self.transition.read().await;
        self.profile_source(id)?;
        let directory = self.paths.profile_dir(id)?.join("backups");
        if !directory.exists() { return Ok(Vec::new()); }
        let mut backups = discover_verified_backups(&directory)?;
        let reset_dir = directory.join("resets");
        if reset_dir.exists() { backups.extend(discover_verified_backups(reset_dir)?); }
        backups.sort_by(|a, b| b.id.cmp(&a.id));
        Ok(backups)
    }

    pub async fn backup(&self, id: &str) -> DbResult<BackupToken> {
        let _permit = self.transition.write().await;
        let snapshot = self.labeled_snapshot(id)?;
        let destination = self.paths.profile_dir(id)?.join("backups");
        let result = publish_backup(&snapshot, &destination, BackupFailurePoint::None);
        let _ = fs::remove_file(snapshot);
        result
    }

    pub async fn export_backup(&self, id: &str, destination: &Path) -> DbResult<PathBuf> {
        self.export_backup_with_failpoint(id, destination, BackupFailurePoint::None).await
    }

    pub async fn export_backup_with_failpoint(&self, id: &str, destination: &Path, failpoint: BackupFailurePoint) -> DbResult<PathBuf> {
        let _permit = self.transition.write().await;
        self.profile_source(id)?;
        self.validate_external_export(destination)?;
        let snapshot = self.labeled_snapshot(id)?;
        let result = export_backup_to_at(&snapshot, destination, failpoint);
        let _ = fs::remove_file(snapshot);
        result
    }

    pub fn validate_external_export(&self, destination: &Path) -> DbResult<()> {
        let absolute = if destination.is_absolute() { destination.to_path_buf() } else { std::env::current_dir().map_err(|_| invalid())?.join(destination) };
        let owned = fs::canonicalize(&self.paths.data_dir).unwrap_or_else(|_| self.paths.data_dir.clone());
        let config = fs::canonicalize(&self.paths.config_dir).unwrap_or_else(|_| self.paths.config_dir.clone());
        let mut existing = absolute.as_path();
        let mut missing = Vec::new();
        while !existing.exists() {
            let name = existing.file_name().ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
            missing.push(name.to_owned());
            existing = existing.parent().ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
        }
        let mut resolved = fs::canonicalize(existing).map_err(|_| invalid())?;
        for name in missing.iter().rev() { resolved.push(name); }
        if resolved.starts_with(&owned) || resolved.starts_with(&config) { return Err(DbError::new(ErrorCode::ProfileExportUnsafe)); }
        Ok(())
    }

    pub async fn inspect_restore(&self, source: &Path) -> DbResult<RestorePreview> {
        let _permit = self.transition.write().await;
        validate_compatible(source)?;
        let root = self.preview_root();
        create_dir_private(&root).map_err(|_| invalid())?;
        let token = OperationId::generate().as_str().to_owned();
        let path = root.join(format!("{token}.sqlite"));
        export_backup_to(source, &path)?;
        let version = match validate_compatible(&path) {
            Ok(version) => version,
            Err(error) => { let _ = fs::remove_file(&path); return Err(error); }
        };
        let name: Option<String> = open_read_only_at(&path)?.query_row(
            "SELECT value FROM app_meta WHERE key = 'profile_display_name'", [], |row| row.get(0)
        ).ok().and_then(|name: String| validate_name(&name).ok());
        let digest = preview_digest(&path)?;
        self.previews.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(token.clone(), PreviewEntry { path, digest });
        let suggested_name = name.unwrap_or_else(|| source.file_stem().and_then(|stem| stem.to_str()).and_then(|stem| validate_name(stem).ok()).unwrap_or_else(|| "Recovered profile".into()));
        Ok(RestorePreview { token, suggested_name, schema_version: version })
    }

    pub async fn cancel_restore(&self, token: &str) -> DbResult<()> {
        let _permit = self.transition.write().await;
        OperationId::parse(token).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        if let Some(entry) = self.previews.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(token) {
            fs::remove_file(entry.path).map_err(|_| invalid())?;
        }
        Ok(())
    }

    pub async fn restore(&self, token: &str, name: &str, context: &OperationContext) -> DbResult<ProfileRecord> {
        let name = validate_name(name)?;
        OperationId::parse(&context.operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        let _permit = self.transition.write().await;
        let journals = JournalStore::new(self.paths.clone());
        if let Some(record) = journals.load(&context.operation_id)? {
            if record.kind != "restore" || record.result.name != name || record.source_token.as_deref() != Some(token) { return Err(DbError::new(ErrorCode::OperationIdConflict)); }
            return self.finish_create(record, super::create::CreateFailurePoint::None);
        }
        let preview = {
            let previews = self.previews.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let entry = previews.get(token).ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
            if preview_digest(&entry.path)? != entry.digest { return Err(invalid()); }
            entry.path.clone()
        };
        let version = validate_compatible(&preview)?;
        let target_id = OperationId::generate().as_str().to_owned();
        let stage = journals.stage_dir(&context.operation_id)?;
        journals.ensure_staging_root()?;
        create_dir_private(&stage).map_err(|_| invalid())?;
        let staged_db = stage.join("notchy.db");
        let staged = (|| -> DbResult<()> {
            export_backup_to(&preview, &staged_db)?;
            if version < LATEST_SCHEMA_VERSION { migrate_supported(&staged_db, version, FailurePoint::None)?; }
            validate_manifest(&open_read_only_at(&staged_db)?, LATEST_SCHEMA_VERSION)?;
            Ok(())
        })();
        if let Err(error) = staged { let _ = fs::remove_dir_all(&stage); return Err(error); }
        let result = ProfileRecord { id: target_id.clone(), name, created_at: now_iso_utc() };
        let record = JournalRecord {
            operation_id: context.operation_id.clone(), kind: "restore".into(), target_id: target_id.clone(),
            phase: JournalPhase::Prepared,
            staging_path: stage.to_string_lossy().into_owned(),
            target_path: self.paths.profile_dir(&target_id)?.to_string_lossy().into_owned(),
            result, source_token: Some(token.to_owned()),
        };
        journals.save(&record)?;
        let result = self.finish_create(record, super::create::CreateFailurePoint::None)?;
        if let Some(entry) = self.previews.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(token) {
            let _ = fs::remove_file(entry.path);
        }
        Ok(result)
    }
}
