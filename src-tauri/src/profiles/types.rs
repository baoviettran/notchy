use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::database::{DbError, DbResult, ErrorCode, OperationId};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRegistry {
    pub version: u8,
    pub profiles: Vec<ProfileRecord>,
    pub last_active_id: Option<String>,
    pub legacy_adopted: bool,
}

impl ProfileRegistry {
    pub fn empty() -> Self {
        Self { version: 1, profiles: Vec::new(), last_active_id: None, legacy_adopted: false }
    }

    pub fn validate(&self) -> DbResult<()> {
        if self.version != 1 {
            return Err(DbError::new(ErrorCode::DatabaseInvalid));
        }
        let mut ids = std::collections::HashSet::new();
        for profile in &self.profiles {
            OperationId::parse(&profile.id).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
            if !ids.insert(profile.id.as_str()) || validate_name(&profile.name)?.as_str() != profile.name {
                return Err(DbError::new(ErrorCode::DatabaseInvalid));
            }
        }
        if let Some(last) = &self.last_active_id {
            OperationId::parse(last).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub locale: String,
    pub theme: String,
}

impl AppPreferences {
    pub fn validate(&self) -> DbResult<()> {
        if !matches!(self.locale.as_str(), "en" | "vi") || !matches!(self.theme.as_str(), "auto" | "light" | "dark") {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(())
    }
}

pub fn validate_name(input: &str) -> DbResult<String> {
    let name = input.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }
    Ok(name.to_owned())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSession {
    pub profile_id: String,
    pub generation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    pub profiles: Vec<ProfileRecord>,
    pub active: Option<ProfileSession>,
    pub phase: String,
    pub preferences: AppPreferences,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OperationContext {
    pub operation_id: String,
    pub transition_token: Option<String>,
}
