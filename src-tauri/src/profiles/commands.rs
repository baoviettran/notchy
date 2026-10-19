use std::{path::{Path, PathBuf}, sync::Arc};
use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;
use crate::database::{BackupSummary, DbError, DbResult, ErrorCode};
use super::backup::RestorePreview;
use super::coordinator::ProfileCoordinator;
use super::delete::DeleteResult;
use super::types::{AppPreferences, OperationContext, ProfileRecord, ProfileSession, ProfileSnapshot};

pub fn authorize_profile_mutation(label: &str) -> DbResult<()> {
    if label == "main" { Ok(()) } else { Err(DbError::new(ErrorCode::UnauthorizedCaller)) }
}
fn map_operation_error(error: DbError) -> DbError {
    if error.code == ErrorCode::OperationIdConflict { DbError::new(ErrorCode::ProfileOperationConflict) } else { error }
}
fn authorize<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> DbResult<()> { authorize_profile_mutation(window.label()) }

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStoragePaths {
    pub data_dir: String,
    pub database_path: String,
    pub routine_backup_dir: String,
    pub upgrade_backup_dir: String,
    pub reset_backup_dir: String,
}
impl ProfileStoragePaths {
    pub fn for_profile(coordinator: &ProfileCoordinator, id: &str) -> DbResult<Self> {
        let dir = coordinator.paths.profile_dir(id)?;
        if !coordinator.load().profiles.iter().any(|profile| profile.id == id) { return Err(DbError::new(ErrorCode::ProfileNotFound)); }
        let backups = dir.join("backups");
        Ok(Self {
            data_dir: dir.to_string_lossy().into_owned(),
            database_path: dir.join("notchy.db").to_string_lossy().into_owned(),
            routine_backup_dir: backups.to_string_lossy().into_owned(),
            upgrade_backup_dir: backups.join("upgrades").to_string_lossy().into_owned(),
            reset_backup_dir: backups.join("resets").to_string_lossy().into_owned(),
        })
    }
}

#[tauri::command]
pub fn profiles_load(coordinator: State<'_, Arc<ProfileCoordinator>>) -> ProfileSnapshot { coordinator.load() }
#[tauri::command]
pub fn profile_paths(coordinator: State<'_, Arc<ProfileCoordinator>>, id: String) -> DbResult<ProfileStoragePaths> {
    ProfileStoragePaths::for_profile(&coordinator, &id)
}
#[tauri::command]
pub async fn profile_discover_backups(coordinator: State<'_, Arc<ProfileCoordinator>>, id: String) -> DbResult<Vec<BackupSummary>> {
    coordinator.backups(&id).await
}
#[tauri::command]
pub async fn profile_create<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, name: String, context: OperationContext) -> DbResult<ProfileRecord> {
    authorize(&window)?;
    coordinator.create(&name, &context).await.map_err(map_operation_error)
}
#[tauri::command]
pub async fn profile_rename<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String, name: String) -> DbResult<ProfileRecord> {
    authorize(&window)?;
    coordinator.rename(&id, &name).await
}
#[tauri::command]
pub async fn profile_activate<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String, transition_token: Option<String>) -> DbResult<ProfileSession> {
    authorize(&window)?;
    coordinator.activate_with_token(&id, transition_token.as_deref()).await
}
#[tauri::command]
pub async fn profile_backup<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String) -> DbResult<String> {
    authorize(&window)?;
    coordinator.backup(&id).await.map(|token| token.id().to_owned())
}
#[tauri::command]
pub async fn profile_export_backup<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String, target_path: String) -> DbResult<()> {
    authorize(&window)?;
    coordinator.export_backup(&id, Path::new(&target_path)).await.map(|_| ())
}
#[tauri::command]
pub async fn profile_inspect_restore<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, source_path: String) -> DbResult<RestorePreview> {
    authorize(&window)?;
    coordinator.inspect_restore(Path::new(&source_path)).await
}
#[tauri::command]
pub async fn profile_cancel_restore<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, token: String) -> DbResult<()> {
    authorize(&window)?;
    coordinator.cancel_restore(&token).await
}
#[tauri::command]
pub async fn profile_restore<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, token: String, name: String, context: OperationContext) -> DbResult<ProfileRecord> {
    authorize(&window)?;
    coordinator.restore(&token, &name, &context).await.map_err(map_operation_error)
}
#[tauri::command]
pub async fn profile_reset<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String, context: OperationContext) -> DbResult<()> {
    authorize(&window)?;
    coordinator.reset(&id, &context).await.map_err(map_operation_error)
}
#[tauri::command]
pub async fn profile_delete<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, id: String, context: OperationContext, export_path: Option<String>) -> DbResult<DeleteResult> {
    authorize(&window)?;
    coordinator.delete(&id, &context, export_path.map(PathBuf::from)).await.map_err(map_operation_error)
}
#[tauri::command]
pub async fn app_preferences_set<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, coordinator: State<'_, Arc<ProfileCoordinator>>, preferences: AppPreferences) -> DbResult<()> {
    authorize(&window)?;
    coordinator.set_preferences(preferences).await
}
