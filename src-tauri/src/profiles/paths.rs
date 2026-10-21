use std::path::PathBuf;

use crate::database::{DbError, DbResult, ErrorCode, OperationId};

#[derive(Debug, Clone)]
pub struct ProfilePaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
}

impl ProfilePaths {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self { config_dir, data_dir }
    }

    pub fn registry_file(&self) -> PathBuf {
        self.config_dir.join("profiles.json")
    }

    pub fn preferences_file(&self) -> PathBuf {
        self.config_dir.join("preferences.json")
    }

    pub fn profile_dir(&self, id: &str) -> DbResult<PathBuf> {
        OperationId::parse(id).map_err(|_| DbError::new(ErrorCode::InvalidUlid))?;
        Ok(self.data_dir.join("profiles").join(id))
    }
}
