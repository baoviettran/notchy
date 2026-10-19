use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

use crate::database::connection::{create_dir_private, set_private_file_permissions};
use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use super::paths::ProfilePaths;
use super::types::{AppPreferences, ProfileRegistry};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishFailurePoint {
    None,
    BeforeRename,
}

pub struct RegistryStore {
    paths: ProfilePaths,
}

impl RegistryStore {
    pub fn new(paths: ProfilePaths) -> Self { Self { paths } }

    pub fn load(&self) -> DbResult<ProfileRegistry> {
        match read_json(&self.paths.registry_file())? {
            None => Ok(ProfileRegistry::empty()),
            Some(bytes) => {
                let registry: ProfileRegistry = serde_json::from_slice(&bytes).map_err(invalid)?;
                registry.validate()?;
                Ok(registry)
            }
        }
    }

    pub fn save(&self, registry: &ProfileRegistry) -> DbResult<()> {
        self.save_with_failpoint(registry, PublishFailurePoint::None)
    }

    pub fn save_with_failpoint(&self, registry: &ProfileRegistry, failpoint: PublishFailurePoint) -> DbResult<()> {
        registry.validate()?;
        publish_json(&self.paths.registry_file(), registry, failpoint)
    }

    pub fn load_preferences(&self) -> DbResult<Option<AppPreferences>> {
        let Some(bytes) = read_json(&self.paths.preferences_file())? else { return Ok(None) };
        let preferences: AppPreferences = serde_json::from_slice(&bytes).map_err(invalid)?;
        preferences.validate()?;
        Ok(Some(preferences))
    }

    pub fn save_preferences(&self, preferences: &AppPreferences) -> DbResult<()> {
        preferences.validate()?;
        publish_json(&self.paths.preferences_file(), preferences, PublishFailurePoint::None)
    }
}

fn invalid(_: impl std::fmt::Display) -> DbError { DbError::new(ErrorCode::DatabaseInvalid) }

pub(crate) fn read_json(path: &Path) -> DbResult<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(invalid(error)),
        Ok(metadata) if !metadata.is_file() => Err(DbError::new(ErrorCode::DatabaseInvalid)),
        Ok(_) => fs::read(path).map(Some).map_err(invalid),
    }
}

pub(crate) fn publish_json(path: &Path, value: &impl serde::Serialize, failpoint: PublishFailurePoint) -> DbResult<()> {
    let parent = path.parent().ok_or_else(|| DbError::new(ErrorCode::DatabaseInvalid))?;
    create_dir_private(parent).map_err(invalid)?;
    let bytes = serde_json::to_vec(value).map_err(invalid)?;
    let temp_path = parent.join(format!(".notchy-profile-{}.tmp", OperationId::generate().as_str()));
    let result = (|| -> DbResult<()> {
        let mut temp = OpenOptions::new().write(true).create_new(true).open(&temp_path).map_err(invalid)?;
        set_private_file_permissions(&temp_path).map_err(invalid)?;
        temp.write_all(&bytes).map_err(invalid)?;
        temp.sync_all().map_err(invalid)?;
        drop(temp);
        if failpoint == PublishFailurePoint::BeforeRename {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        if let Ok(metadata) = fs::symlink_metadata(path) {
            if !metadata.is_file() { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
        }
        fs::rename(&temp_path, path).map_err(invalid)?;
        sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp_path); }
    result
}

pub(crate) fn sync_directory(path: &Path) -> DbResult<()> {
    #[cfg(unix)]
    File::open(path).and_then(|file| file.sync_all()).map_err(invalid)?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
