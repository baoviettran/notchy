use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::fs;
use super::windows::TransitionState;

use crate::database::connection::DatabasePaths;
use crate::database::executor::{DatabaseManager, ExecutorState};
use crate::database::{DbError, DbResult, ErrorCode, OperationId, ProcessLock};
use super::paths::ProfilePaths;
use super::backup::PreviewEntry;
use super::registry::RegistryStore;
use super::types::{AppPreferences, ProfileRegistry, ProfileSession, ProfileSnapshot, ProfileRecovery};

pub(super) struct ActiveProfile {
    pub(super) session: ProfileSession,
    pub(super) manager: Arc<DatabaseManager>,
}

pub(super) struct State {
    pub(super) registry: ProfileRegistry,
    pub(super) active: Option<ActiveProfile>,
    pub(super) recovery: bool,
}

/// Owns the application lock even when no profile database is open.
pub struct ProfileCoordinator {
    pub(super) paths: ProfilePaths,
    pub(super) store: RegistryStore,
    lock: Arc<ProcessLock>,
    pub(super) transition: tokio::sync::RwLock<()>,
    pub(super) state: Mutex<State>,
    pub(super) previews: Mutex<HashMap<String, PreviewEntry>>,
    pub(super) transition_tokens: Mutex<HashMap<String, Option<ProfileSession>>>,
    pub(super) windows: Mutex<TransitionState>,
}

impl ProfileCoordinator {
    pub fn open(paths: ProfilePaths) -> DbResult<Arc<Self>> {
        let lock = Arc::new(ProcessLock::acquire(&paths.config_dir.join("notchy.lock"))?);
        let store = RegistryStore::new(paths.clone());
        let registry = store.load()?;
        let preview_root = paths.data_dir.join("profile-operations/previews");
        if preview_root.exists() { std::fs::remove_dir_all(&preview_root).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?; }
        let coordinator = Arc::new(Self {
            paths, store, lock,
            transition: tokio::sync::RwLock::new(()),
            state: Mutex::new(State { registry, active: None, recovery: false }),
            previews: Mutex::new(HashMap::new()),
            transition_tokens: Mutex::new(HashMap::new()),
            windows: Mutex::new(TransitionState::default()),
        });
        coordinator.reconcile_operations()?;
        coordinator.reconcile_resets()?;
        coordinator.reconcile_deletes()?;
        Ok(coordinator)
    }

    /// A one-use process token; the window draft barrier will be its only command caller.
    pub fn issue_transition_token(&self) -> String {
        let token = OperationId::generate().as_str().to_owned();
        let current = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).active.as_ref().map(|active| active.session.clone());
        self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).insert(token.clone(), current);
        token
    }

    pub(super) fn require_transition_token(&self, id: &str, token: Option<&str>) -> DbResult<()> {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !state.active.as_ref().is_some_and(|active| active.session.profile_id == id) { return Ok(()); }
        drop(state);
        let Some(token) = token else { return Err(DbError::new(ErrorCode::ProfileTransitionBlocked)); };
        let current = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).active.as_ref().map(|active| active.session.clone());
        if self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(token).flatten() != current {
            return Err(DbError::new(ErrorCode::ProfileTransitionBlocked));
        }
        Ok(())
    }

    pub async fn set_preferences(&self, preferences: AppPreferences) -> DbResult<()> {
        let _permit = self.transition.write().await;
        self.store.save_preferences(&preferences)
    }

    pub async fn activate_with_token(&self, id: &str, token: Option<&str>) -> DbResult<ProfileSession> {
        let _permit = self.transition.write().await;
        self.require_transition_token_for_active(token)?;
        self.activate_locked(id).await
    }

    fn require_transition_token_for_active(&self, token: Option<&str>) -> DbResult<()> {
        let active = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).active.as_ref().map(|active| active.session.clone());
        if active.is_none() { return Ok(()); }
        let token = token.ok_or_else(|| DbError::new(ErrorCode::ProfileTransitionBlocked))?;
        let stored = self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(token).flatten();
        if stored != active { return Err(DbError::new(ErrorCode::ProfileTransitionBlocked)); }
        Ok(())
    }

    pub fn load(&self) -> ProfileSnapshot {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        ProfileSnapshot {
            profiles: state.registry.profiles.clone(),
            active: state.active.as_ref().map(|active| active.session.clone()),
            phase: if state.recovery { "recovery" } else { "idle" }.into(),
            preferences: self.store.load_preferences().ok().flatten().unwrap_or(AppPreferences { locale: "en".into(), theme: "light".into() }),
            recovery: if state.recovery { Some(ProfileRecovery { profile_id: state.registry.last_active_id.clone(), code: ErrorCode::DatabaseNotReady, retryable: true }) } else { None },
        }
    }

    /// Admit exactly one database job under the immutable profile generation.
    pub async fn with_session<T, F>(&self, session: &ProfileSession, job: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut ExecutorState) -> DbResult<T> + Send + 'static,
    {
        let _permit = self.transition.read().await;
        let manager = {
            let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let active = state.active.as_ref().ok_or_else(|| DbError::new(ErrorCode::ProfileSessionExpired))?;
            if active.session != *session { return Err(DbError::new(ErrorCode::ProfileSessionExpired)); }
            Arc::clone(&active.manager)
        };
        manager.data_job(job).await
    }

    pub async fn activate(&self, id: &str) -> DbResult<ProfileSession> {
        let _permit = self.transition.write().await;
        self.activate_locked(id).await
    }

    async fn activate_locked(&self, id: &str) -> DbResult<ProfileSession> {
        let old = {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.registry.profiles.iter().any(|profile| profile.id == id) {
                return Err(DbError::new(ErrorCode::ProfileNotFound));
            }
            state.active.take()
        };
        let old_id = old.as_ref().map(|active| active.session.profile_id.clone());
        if let Some(active) = old { active.manager.shutdown(); }

        match self.open_manager(id).await {
            Ok(manager) => match self.commit_activation(id, manager) {
                Ok(session) => Ok(session),
                Err(error) => {
                    self.reopen_previous(old_id.as_deref()).await;
                    Err(error)
                }
            },
            Err(error) => {
                self.reopen_previous(old_id.as_deref()).await;
                Err(error)
            }
        }
    }

    fn commit_activation(&self, id: &str, manager: Arc<DatabaseManager>) -> DbResult<ProfileSession> {
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut registry = state.registry.clone();
        registry.last_active_id = Some(id.to_owned());
        if let Err(error) = self.store.save(&registry) {
            manager.shutdown();
            return Err(error);
        }
        let session = Self::new_session(id);
        state.registry = registry;
        state.active = Some(ActiveProfile { session: session.clone(), manager });
        state.recovery = false;
        Ok(session)
    }

    pub(super) fn suspend_active(&self, id: &str) -> bool {
        let active = {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.active.as_ref().is_some_and(|active| active.session.profile_id == id) { state.active.take() } else { None }
        };
        if let Some(active) = active { active.manager.shutdown(); true } else { false }
    }

    pub(super) async fn reopen_previous(&self, id: Option<&str>) {
        let reopened = match id {
            Some(id) => self.open_manager(id).await.ok().map(|manager| ActiveProfile { session: Self::new_session(id), manager }),
            None => None,
        };
        let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.recovery = id.is_some() && reopened.is_none();
        state.active = reopened;
    }

    async fn open_manager(&self, id: &str) -> DbResult<Arc<DatabaseManager>> {
        let dir = self.paths.profile_dir(id)?;
        let paths = DatabasePaths::new(dir.clone(), dir);
        let metadata = fs::symlink_metadata(&paths.db_path).map_err(|_| DbError::new(ErrorCode::DatabaseInvalid))?;
        if !metadata.is_file() { return Err(DbError::new(ErrorCode::DatabaseInvalid)); }
        let manager = DatabaseManager::spawn_with_lock(paths, 64, Arc::clone(&self.lock))?;
        if let Err(error) = manager.initialize().await {
            manager.shutdown();
            return Err(error);
        }
        let owner = id.to_owned();
        if let Err(error) = manager.data_job(move |state| {
            crate::database::automatic_backup::bind_automatic_owner(state.connection_mut()?, &owner, false)
        }).await {
            manager.shutdown();
            return Err(error);
        }
        Ok(manager)
    }

    fn new_session(id: &str) -> ProfileSession {
        ProfileSession { profile_id: id.to_owned(), generation: OperationId::generate().as_str().to_owned() }
    }
}

impl Drop for ProfileCoordinator {
    fn drop(&mut self) {
        let state = self.state.get_mut().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(active) = state.active.take() { active.manager.shutdown(); }
    }
}
