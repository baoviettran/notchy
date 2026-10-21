use std::{fs, path::PathBuf};
use serde::{Deserialize, Serialize};
use crate::database::{BackupFailurePoint, DbError, DbResult, ErrorCode, OperationId};
use crate::database::backup::publish_backup;
use crate::database::connection::{create_dir_private, open_read_only_at};
use crate::database::manifest::validate_manifest;
use crate::database::migrations::{bootstrap_current, FailurePoint, LATEST_SCHEMA_VERSION};
use super::coordinator::ProfileCoordinator;
use super::registry::{publish_json, read_json, sync_directory, PublishFailurePoint};
use super::types::OperationContext;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetRecord { operation_id: String, profile_id: String, phase: String }
fn invalid() -> DbError { DbError::new(ErrorCode::DatabaseInvalid) }

// The debug-only probe exits without stack unwinding so the restart tests can
// inspect the exact files left at each durable reset boundary.
#[cfg(debug_assertions)]
fn profile_probe_crash(point: &str) {
    if std::env::var("NOTCHY_PROFILE_RESET_CRASH_AT").as_deref() == Ok(point) {
        std::process::exit(86);
    }
}
#[cfg(not(debug_assertions))]
fn profile_probe_crash(_point: &str) {}


impl ProfileCoordinator {
    fn reset_root(&self) -> PathBuf { self.paths.data_dir.join("profile-operations/resets") }
    fn reset_path(&self, operation_id: &str) -> DbResult<PathBuf> {
        OperationId::parse(operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        Ok(self.reset_root().join(format!("{operation_id}.json")))
    }
    fn reset_stage(&self, operation_id: &str) -> PathBuf { self.reset_root().join(operation_id) }
    fn load_reset(&self, operation_id: &str) -> DbResult<Option<ResetRecord>> {
        let Some(bytes) = read_json(&self.reset_path(operation_id)?)? else { return Ok(None) };
        serde_json::from_slice(&bytes).map(Some).map_err(|_| invalid())
    }
    fn save_reset(&self, record: &ResetRecord) -> DbResult<()> {
        publish_json(&self.reset_path(&record.operation_id)?, record, PublishFailurePoint::None)
    }
    pub async fn reset(&self, id: &str, context: &OperationContext) -> DbResult<()> {
        self.reset_with_failpoint(id, context, BackupFailurePoint::None).await
    }
    pub async fn reset_with_failpoint(&self, id: &str, context: &OperationContext, failpoint: BackupFailurePoint) -> DbResult<()> {
        OperationId::parse(&context.operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        let _permit = self.transition.write().await;
        self.profile_source(id)?;
        if let Some(record) = self.load_reset(&context.operation_id)? {
            if record.profile_id != id { return Err(DbError::new(ErrorCode::OperationIdConflict)); }
            return self.finish_reset(&record).await;
        }
        self.require_transition_token(id, context.transition_token.as_deref())?;
        let snapshot = self.labeled_snapshot(id)?;
        let reset_backups = self.paths.profile_dir(id)?.join("backups/resets");
        let backup = publish_backup(&snapshot, &reset_backups, failpoint);
        let _ = fs::remove_file(snapshot);
        backup?;
        profile_probe_crash("after-backup");
        let stage = self.reset_stage(&context.operation_id);
        create_dir_private(&stage).map_err(|_| invalid())?;
        bootstrap_current(&stage.join("notchy.db"), FailurePoint::None)?;
        let record = ResetRecord { operation_id: context.operation_id.clone(), profile_id: id.to_owned(), phase: "prepared".into() };
        self.save_reset(&record)?;
        profile_probe_crash("after-prepared");
        self.finish_reset(&record).await
    }
    async fn finish_reset(&self, record: &ResetRecord) -> DbResult<()> {
        if record.phase == "committed" { return Ok(()); }
        let id = &record.profile_id;
        let live = self.paths.profile_dir(id)?.join("notchy.db");
        let stage = self.reset_stage(&record.operation_id);
        let replacement = stage.join("notchy.db");
        let rollback = stage.join("original.db");
        let was_active = self.suspend_active(id);
        let result = (|| -> DbResult<()> {
            if !rollback.exists() { fs::rename(&live, &rollback).map_err(|_| invalid())?; }
            profile_probe_crash("after-move-original");
            if replacement.exists() { fs::rename(&replacement, &live).map_err(|_| invalid())?; }
            profile_probe_crash("after-move-replacement");
            validate_manifest(&open_read_only_at(&live)?, LATEST_SCHEMA_VERSION)?;
            sync_directory(live.parent().ok_or_else(invalid)?)?;
            let mut committed = record.clone(); committed.phase = "committed".into();
            self.save_reset(&committed)?;
            profile_probe_crash("after-commit");
            Ok(())
        })();
        if result.is_err() && rollback.exists() {
            let _ = fs::remove_file(&live);
            let _ = fs::rename(&rollback, &live);
            let _ = fs::remove_file(self.reset_path(&record.operation_id)?);
        }
        if was_active { self.reopen_previous(Some(id)).await; }
        result?;
        let _ = fs::remove_dir_all(stage);
        Ok(())
    }
    pub fn reconcile_resets(&self) -> DbResult<()> {
        let root = self.reset_root();
        let entries = match fs::read_dir(&root) { Ok(entries) => entries, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(_) => return Err(invalid()) };
        for entry in entries {
            let entry = entry.map_err(|_| invalid())?;
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
            let Some(id) = name.strip_suffix(".json") else { continue };
            let record = self.load_reset(id)?.ok_or_else(invalid)?;
            if record.phase == "committed" {
                let _ = fs::remove_dir_all(self.reset_stage(id));
                continue;
            }
            let live = self.paths.profile_dir(&record.profile_id)?.join("notchy.db");
            let stage = self.reset_stage(id);
            let replacement = stage.join("notchy.db");
            let rollback = stage.join("original.db");
            if !rollback.exists() && !replacement.exists() && live.exists() {
                fs::remove_file(self.reset_path(id)?).map_err(|_| invalid())?;
                continue;
            }
            if rollback.exists() && !live.exists() && !replacement.exists() {
                fs::rename(&rollback, &live).map_err(|_| invalid())?;
                return Err(invalid());
            }
            if !rollback.exists() { fs::rename(&live, &rollback).map_err(|_| invalid())?; }
            if replacement.exists() { fs::rename(&replacement, &live).map_err(|_| invalid())?; }
            validate_manifest(&open_read_only_at(&live)?, LATEST_SCHEMA_VERSION)?;
            let mut committed = record.clone(); committed.phase = "committed".into(); self.save_reset(&committed)?;
            let _ = fs::remove_dir_all(stage);
        }
        Ok(())
    }
}
