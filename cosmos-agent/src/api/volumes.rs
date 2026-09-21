use crate::{ api::CachedJson, error::AgentError, state::AppState };
use axum::{
    extract::{ Path, Query, State },
    http::StatusCode,
    response::IntoResponse,
};
use serde::Deserialize;

pub async fn list(State(state): State<AppState>) -> impl IntoResponse {
    CachedJson(state.volumes_rx.borrow().json.clone())
}

#[derive(Deserialize, Default)]
pub struct RemoveQuery {
    #[serde(default)]
    force: bool,
}

pub async fn remove(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<RemoveQuery>
) -> Result<StatusCode, AgentError> {
    state.docker.remove_volume(&name, q.force).await?;
    Ok(StatusCode::NO_CONTENT)
}
