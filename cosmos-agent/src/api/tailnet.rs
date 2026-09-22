use crate::{ api::CachedJson, error::AgentError, state::AppState };
use axum::extract::State;

/// 501 when `[tailscale]` is off, so the app hides the Devices page; 503
/// when it's on but `tailscaled` can't be read, so it shows why and retries.
pub async fn current(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    let rx = state.tailnet_rx.as_ref().ok_or(AgentError::NotEnabled("tailnet"))?;
    let snapshot = rx.borrow().clone();
    match &snapshot.result {
        Ok(data) => Ok(CachedJson(data.json.clone())),
        Err(e) => Err(AgentError::Unavailable(e.clone())),
    }
}
