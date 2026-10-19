use std::fs;
use crate::database::connection::{create_dir_private, open_read_only_at};
use crate::database::manifest::validate_manifest;
use crate::database::migrations::{bootstrap_current, now_iso_utc, FailurePoint, LATEST_SCHEMA_VERSION};
use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use super::coordinator::ProfileCoordinator;
use super::journal::{JournalPhase, JournalRecord, JournalStore};
use super::registry::sync_directory;
use super::types::{OperationContext, ProfileRecord, validate_name};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateFailurePoint { None, BeforePublish, AfterPublish }

impl ProfileCoordinator {
    pub async fn create(&self, name: &str, context: &OperationContext) -> DbResult<ProfileRecord> {
        self.create_with_failpoint(name, context, CreateFailurePoint::None).await
    }

    pub async fn create_with_failpoint(&self, name: &str, context: &OperationContext, failpoint: CreateFailurePoint) -> DbResult<ProfileRecord> {
        let name = validate_name(name)?;
        OperationId::parse(&context.operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        let _permit = self.transition.write().await;
        let journals = JournalStore::new(self.paths.clone());
        let record = match journals.load(&context.operation_id)? {
            Some(record) => {
                if record.result.name != name { return Err(DbError::new(ErrorCode::OperationIdConflict)); }
                record
            }
            None => {
                let target_id = OperationId::generate().as_str().to_owned();
                let result = ProfileRecord { id: target_id.clone(), name, created_at: now_iso_utc() };
                let record = JournalRecord {
                    operation_id: context.operation_id.clone(), kind: "create".into(), target_id: target_id.clone(),
                    phase: JournalPhase::Prepared,
                    staging_path: journals.stage_dir(&context.operation_id)?.to_string_lossy().into_owned(),
                    target_path: self.paths.profile_dir(&target_id)?.to_string_lossy().into_owned(),
                    result, source_token: None,
                };
                journals.save(&record)?;
                record
            }
        };
        self.finish_create(record, failpoint)
    }

    pub async fn rename(&self, id: &str, name: &str) -> DbResult<ProfileRecord> {
        let name = validate_name(name)?;
        let _permit = self.transition.write().await;
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut next = state.registry.clone();
        let profile = next.profiles.iter_mut().find(|profile| profile.id == id).ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
        profile.name = name;
        let result = profile.clone();
        self.store.save(&next)?;
        state.registry = next;
        Ok(result)
    }

    pub fn reconcile_operations(&self) -> DbResult<()> {
        let journals = JournalStore::new(self.paths.clone());
        for record in journals.all()? {
            if record.phase != JournalPhase::Committed { self.finish_create(record, CreateFailurePoint::None)?; }
        }
        Ok(())
    }

    pub(super) fn finish_create(&self, mut record: JournalRecord, failpoint: CreateFailurePoint) -> DbResult<ProfileRecord> {
        let journals = JournalStore::new(self.paths.clone());
        let stage_dir = journals.stage_dir(&record.operation_id)?;
        let target_dir = self.paths.profile_dir(&record.target_id)?;
        if record.phase == JournalPhase::Committed {
            let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.registry.profiles.iter().any(|p| p == &record.result) { return Ok(record.result); }
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        if !target_dir.exists() {
            if !stage_dir.exists() {
                if record.kind == "restore" { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
                journals.ensure_staging_root()?;
                create_dir_private(&stage_dir).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
                bootstrap_current(&stage_dir.join("notchy.db"), FailurePoint::None)?;
            }
            self.validate_created_db(&stage_dir.join("notchy.db"))?;
            if failpoint == CreateFailurePoint::BeforePublish { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
            let profiles_root = self.paths.data_dir.join("profiles");
            create_dir_private(&profiles_root).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
            fs::rename(&stage_dir, &target_dir).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
            sync_directory(&profiles_root)?;
        }
        self.validate_created_db(&target_dir.join("notchy.db"))?;
        record.phase = JournalPhase::Published;
        journals.save(&record)?;
        if failpoint == CreateFailurePoint::AfterPublish { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
        {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(existing) = state.registry.profiles.iter().find(|p| p.id == record.target_id) {
                if existing != &record.result { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
            } else {
                let mut next = state.registry.clone();
                next.profiles.push(record.result.clone());
                self.store.save(&next)?;
                state.registry = next;
            }
        }
        record.phase = JournalPhase::Committed;
        journals.save(&record)?;
        Ok(record.result)
    }

    fn validate_created_db(&self, path: &std::path::Path) -> DbResult<()> {
        let connection = open_read_only_at(path)?;
        validate_manifest(&connection, LATEST_SCHEMA_VERSION)
    }
}
