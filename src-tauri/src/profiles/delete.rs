use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use super::coordinator::ProfileCoordinator;
use super::registry::{publish_json, read_json, sync_directory, PublishFailurePoint};
use super::types::OperationContext;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteFailurePoint { None, AfterRename, BeforeCleanup }
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult { pub cleanup_pending: bool }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteRecord { operation_id: String, profile_id: String, phase: String, result: DeleteResult }
fn invalid() -> DbError { DbError::new(ErrorCode::DatabaseInvalid) }

impl ProfileCoordinator {
    fn delete_root(&self) -> PathBuf { self.paths.data_dir.join("profile-operations/deletes") }
    fn delete_path(&self, operation_id: &str) -> DbResult<PathBuf> {
        OperationId::parse(operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        Ok(self.delete_root().join(format!("{operation_id}.json")))
    }
    fn trash_dir(&self, operation_id: &str) -> PathBuf { self.delete_root().join(operation_id) }
    fn load_delete(&self, operation_id: &str) -> DbResult<Option<DeleteRecord>> {
        let Some(bytes) = read_json(&self.delete_path(operation_id)?)? else { return Ok(None) };
        serde_json::from_slice(&bytes).map(Some).map_err(|_| invalid())
    }
    fn save_delete(&self, record: &DeleteRecord) -> DbResult<()> {
        publish_json(&self.delete_path(&record.operation_id)?, record, PublishFailurePoint::None)
    }
    pub async fn delete(&self, id: &str, context: &OperationContext, export_path: Option<PathBuf>) -> DbResult<DeleteResult> {
        self.delete_with_failpoint(id, context, export_path, DeleteFailurePoint::None).await
    }
    pub async fn delete_with_failpoint(&self, id: &str, context: &OperationContext, export_path: Option<PathBuf>, failpoint: DeleteFailurePoint) -> DbResult<DeleteResult> {
        OperationId::parse(&context.operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        let _permit = self.transition.write().await;
        if let Some(record) = self.load_delete(&context.operation_id)? {
            if record.profile_id != id { return Err(DbError::new(ErrorCode::OperationIdConflict)); }
            if record.phase == "committed" { return Ok(record.result); }
            self.reconcile_deletes()?;
        }
        self.profile_source(id)?;
        self.require_transition_token(id, context.transition_token.as_deref())?;
        if let Some(path) = &export_path {
            self.validate_external_export(path)?;
            let snapshot = self.labeled_snapshot(id)?;
            let result = crate::database::backup::export_backup_to(&snapshot, path);
            let _ = fs::remove_file(snapshot);
            result?;
        }
        let mut record = DeleteRecord { operation_id: context.operation_id.clone(), profile_id: id.into(), phase: "prepared".into(), result: DeleteResult { cleanup_pending: true } };
        self.save_delete(&record)?;
        let was_active = self.suspend_active(id);
        let source = self.paths.profile_dir(id)?;
        let trash = self.trash_dir(&context.operation_id);
        if let Err(_) = fs::rename(&source, &trash) {
            if was_active { self.reopen_previous(Some(id)).await; }
            return Err(invalid());
        }
        sync_directory(source.parent().ok_or_else(invalid)?)?;
        if failpoint == DeleteFailurePoint::AfterRename { return Err(invalid()); }
        let commit = (|| -> DbResult<()> {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let mut next = state.registry.clone();
            next.profiles.retain(|profile| profile.id != id);
            if next.last_active_id.as_deref() == Some(id) { next.last_active_id = None; }
            self.store.save(&next)?;
            state.registry = next;
            Ok(())
        })();
        if let Err(error) = commit {
            let _ = fs::rename(&trash, &source);
            if was_active { self.reopen_previous(Some(id)).await; }
            return Err(error);
        }
        record.phase = "committed".into();
        if self.save_delete(&record).is_err() { return Ok(record.result); }
        if failpoint == DeleteFailurePoint::BeforeCleanup { return Ok(record.result); }
        if fs::remove_dir_all(&trash).is_ok() {
            let _ = sync_directory(&self.delete_root());
            record.result.cleanup_pending = false;
            if self.save_delete(&record).is_err() { record.result.cleanup_pending = true; }
        }
        Ok(record.result)
    }
    pub fn reconcile_deletes(&self) -> DbResult<()> {
        let root = self.delete_root();
        let entries = match fs::read_dir(&root) { Ok(entries) => entries, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(_) => return Err(invalid()) };
        for entry in entries {
            let entry = entry.map_err(|_| invalid())?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
            let Some(id) = name.strip_suffix(".json") else { continue };
            let mut record = self.load_delete(id)?.ok_or_else(invalid)?;
            let source = self.paths.profile_dir(&record.profile_id)?;
            let trash = self.trash_dir(id);
            let registered = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).registry.profiles.iter().any(|p| p.id == record.profile_id);
            if registered {
                if trash.exists() && !source.exists() { fs::rename(&trash, &source).map_err(|_| invalid())?; }
                fs::remove_file(self.delete_path(id)?).map_err(|_| invalid())?;
                continue;
            }
            if trash.exists() {
                if fs::remove_dir_all(&trash).is_err() { continue; }
            }
            record.phase = "committed".into(); record.result.cleanup_pending = false; self.save_delete(&record)?;
        }
        Ok(())
    }
}
