use crate::{ api::CachedJson, error::AgentError, state::AppState };
use axum::extract::State;

pub async fn current(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    let rx = state.backups_rx.as_ref().ok_or(AgentError::NotEnabled("backups"))?;
    Ok(CachedJson(rx.borrow().json.clone()))
}
