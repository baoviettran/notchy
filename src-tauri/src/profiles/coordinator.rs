use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use crate::database::connection::DatabasePaths;
use crate::database::executor::{DatabaseManager, ExecutorState};
use crate::database::{DbError, DbResult, ErrorCode, OperationId, ProcessLock};
use super::paths::ProfilePaths;
use super::backup::PreviewEntry;
use super::registry::RegistryStore;
use super::types::{AppPreferences, ProfileRegistry, ProfileSession, ProfileSnapshot};

struct ActiveProfile {
    session: ProfileSession,
    manager: Arc<DatabaseManager>,
}

pub(super) struct State {
    pub(super) registry: ProfileRegistry,
    active: Option<ActiveProfile>,
    recovery: bool,
}

/// Owns the application lock even when no profile database is open.
pub struct ProfileCoordinator {
    pub(super) paths: ProfilePaths,
    pub(super) store: RegistryStore,
    lock: Arc<ProcessLock>,
    pub(super) transition: tokio::sync::RwLock<()>,
    pub(super) state: Mutex<State>,
    pub(super) previews: Mutex<HashMap<String, PreviewEntry>>,
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
        });
        coordinator.reconcile_operations()?;
        Ok(coordinator)
    }

    pub fn load(&self) -> ProfileSnapshot {
        let state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        ProfileSnapshot {
            profiles: state.registry.profiles.clone(),
            active: state.active.as_ref().map(|active| active.session.clone()),
            phase: if state.recovery { "recovery" } else { "idle" }.into(),
            preferences: self.store.load_preferences().ok().flatten().unwrap_or(AppPreferences { locale: "en".into(), theme: "light".into() }),
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
            let active = state.active.as_ref().ok_or_else(|| DbError::new(ErrorCode::DatabaseNotReady))?;
            if active.session != *session { return Err(DbError::new(ErrorCode::DatabaseNotReady)); }
            Arc::clone(&active.manager)
        };
        manager.data_job(job).await
    }

    pub async fn activate(&self, id: &str) -> DbResult<ProfileSession> {
        let _permit = self.transition.write().await;
        let old = {
            let mut state = self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !state.registry.profiles.iter().any(|profile| profile.id == id) {
                return Err(DbError::new(ErrorCode::InvalidInput));
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

    async fn reopen_previous(&self, id: Option<&str>) {
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
        let manager = DatabaseManager::spawn_with_lock(paths, 64, Arc::clone(&self.lock))?;
        if let Err(error) = manager.initialize().await {
            manager.shutdown();
            return Err(error);
        }
        Ok(manager)
    }

    fn new_session(id: &str) -> ProfileSession {
        ProfileSession { profile_id: id.to_owned(), generation: OperationId::generate().as_str().to_owned() }
    }
}
