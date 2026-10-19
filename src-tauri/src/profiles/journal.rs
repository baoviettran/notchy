use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use crate::database::connection::create_dir_private;
use super::paths::ProfilePaths;
use super::registry::{publish_json, read_json, sync_directory, PublishFailurePoint};
use super::types::ProfileRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JournalPhase { Prepared, Published, Committed, CleanupPending }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalRecord {
    pub operation_id: String,
    pub kind: String,
    pub target_id: String,
    pub phase: JournalPhase,
    pub staging_path: String,
    pub target_path: String,
    pub result: ProfileRecord,
    #[serde(default)]
    pub source_token: Option<String>,
}

pub struct JournalStore { paths: ProfilePaths }

impl JournalStore {
    pub fn new(paths: ProfilePaths) -> Self { Self { paths } }

    pub fn root(&self) -> PathBuf { self.paths.data_dir.join("profile-operations") }

    pub fn stage_dir(&self, operation_id: &str) -> DbResult<PathBuf> {
        OperationId::parse(operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        Ok(self.root().join("staging").join(operation_id))
    }

    fn record_path(&self, operation_id: &str) -> DbResult<PathBuf> {
        OperationId::parse(operation_id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        Ok(self.root().join(format!("{operation_id}.json")))
    }

    pub fn load(&self, operation_id: &str) -> DbResult<Option<JournalRecord>> {
        let Some(bytes) = read_json(&self.record_path(operation_id)?)? else { return Ok(None) };
        let record: JournalRecord = serde_json::from_slice(&bytes).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        self.validate(&record)?;
        Ok(Some(record))
    }

    pub fn save(&self, record: &JournalRecord) -> DbResult<()> {
        self.validate(record)?;
        publish_json(&self.record_path(&record.operation_id)?, record, PublishFailurePoint::None)
    }

    pub fn all(&self) -> DbResult<Vec<JournalRecord>> {
        let root = self.root();
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(DbError::new(ErrorCode::DatabaseInvalid)),
        };
        let mut records = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".json")) else { continue };
            records.push(self.load(id)?.ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?);
        }
        Ok(records)
    }

    pub fn remove(&self, operation_id: &str) -> DbResult<()> {
        let path = self.record_path(operation_id)?;
        match fs::remove_file(path) {
            Ok(()) => sync_directory(&self.root()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(DbError::new(ErrorCode::DatabaseInvalid)),
        }
    }

    pub fn ensure_staging_root(&self) -> DbResult<()> {
        create_dir_private(&self.root().join("staging")).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))
    }

    fn validate(&self, record: &JournalRecord) -> DbResult<()> {
        OperationId::parse(&record.operation_id).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        OperationId::parse(&record.target_id).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        if !matches!(record.kind.as_str(), "create" | "restore") ||
            (record.kind == "restore" && record.source_token.as_deref().and_then(|token| OperationId::parse(token).ok()).is_none()) ||
            record.result.id != record.target_id ||
            record.staging_path != self.stage_dir(&record.operation_id)?.to_string_lossy() ||
            record.target_path != self.paths.profile_dir(&record.target_id)?.to_string_lossy() {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        Ok(())
    }
}
