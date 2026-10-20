use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use crate::database::{DbError, DbResult, ErrorCode, OperationId};
use super::coordinator::ProfileCoordinator;
use super::types::ProfileSession;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TransitionRequest {
    pub request_id: String,
    pub expected_session: Option<ProfileSession>,
    pub required_labels: Vec<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionReady { pub request_id: String, pub transition_token: String }
#[derive(Default)]
pub(super) struct TransitionState { pending: Option<Pending> }
struct Pending {
    request: TransitionRequest,
    acknowledged: HashSet<String>,
    token: Option<String>,
}
fn blocked() -> DbError { DbError::new(ErrorCode::ProfileTransitionBlocked) }

impl ProfileCoordinator {
    pub fn prepare_transition(&self, expected: Option<ProfileSession>, labels: Vec<String>) -> DbResult<TransitionRequest> {
        if self.load().active != expected { return Err(DbError::new(ErrorCode::ProfileSessionExpired)); }
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.pending.is_some() { return Err(blocked()); }
        let mut unique = HashSet::new();
        let required_labels: Vec<_> = labels.into_iter().filter(|label| unique.insert(label.clone())).collect();
        if !required_labels.iter().any(|label| label == "main") { return Err(blocked()); }
        let request = TransitionRequest { request_id: OperationId::generate().as_str().to_owned(), expected_session: expected, required_labels };
        state.pending = Some(Pending { request: request.clone(), acknowledged: HashSet::new(), token: None });
        Ok(request)
    }
    pub fn ack_transition(&self, request_id: &str, label: &str, _dirty: bool, resolved: bool) -> DbResult<Option<String>> {
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = state.pending.as_mut().ok_or_else(blocked)?;
        if pending.request.request_id != request_id || !pending.request.required_labels.iter().any(|required| required == label) { return Err(blocked()); }
        if self.load().active != pending.request.expected_session { return Err(DbError::new(ErrorCode::ProfileSessionExpired)); }
        if !resolved {
            pending.acknowledged.remove(label);
            if let Some(token) = pending.token.take() { self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&token); }
            return Ok(None);
        }
        if !pending.acknowledged.insert(label.to_owned()) { return Ok(None); }
        if pending.acknowledged.len() != pending.request.required_labels.len() { return Ok(None); }
        pending.token = Some(self.issue_transition_token());
        Ok(pending.token.clone())
    }
    pub fn transition_token(&self, request_id: &str) -> Option<String> {
        let state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        state.pending.as_ref().filter(|pending| pending.request.request_id == request_id).and_then(|pending| pending.token.clone())
    }
    pub fn cancel_transition(&self, request_id: &str) -> DbResult<()> {
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = state.pending.take().ok_or_else(blocked)?;
        if pending.request.request_id != request_id { state.pending = Some(pending); return Err(blocked()); }
        if let Some(token) = pending.token { self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&token); }
        Ok(())
    }
    pub fn window_opened(&self, label: &str) -> Option<TransitionRequest> {
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = state.pending.as_mut()?;
        if !pending.request.required_labels.iter().any(|required| required == label) {
            pending.request.required_labels.push(label.to_owned());
            if let Some(token) = pending.token.take() { self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&token); }
        }
        Some(pending.request.clone())
    }
    pub fn window_closed(&self, label: &str) -> Option<TransitionReady> {
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let pending = state.pending.as_mut()?;
        pending.request.required_labels.retain(|required| required != label);
        pending.acknowledged.remove(label);
        if pending.token.is_none() && pending.acknowledged.len() == pending.request.required_labels.len() {
            pending.token = Some(self.issue_transition_token());
            return Some(TransitionReady { request_id: pending.request.request_id.clone(), transition_token: pending.token.clone().unwrap() });
        }
        None
    }
    pub fn finish_transition(&self) {
        let mut state = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(pending) = state.pending.take() {
            if let Some(token) = pending.token { self.transition_tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(&token); }
        }
    }
}
