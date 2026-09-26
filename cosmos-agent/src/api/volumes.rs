use crate::{
    api::{ record_action, Action, CachedJson },
    auth::Principal,
    error::AgentError,
    sse,
    state::AppState,
};
use axum::{
    extract::{ Path, Query, State },
    http::StatusCode,
    response::{ sse::{ Event, Sse }, IntoResponse },
    Extension,
};
use futures_util::Stream;
use serde::Deserialize;
use std::convert::Infallible;

pub async fn list(State(state): State<AppState>) -> impl IntoResponse {
    CachedJson(state.volumes_rx.borrow().json.clone())
}

/// Pushed on every change, so a delete (from here or the CLI) and a volume
/// freed by a removed container show up at once instead of on the next poll.
pub async fn stream(
    State(state): State<AppState>
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    sse::stream_watch(state.volumes_rx.clone(), |snap| snap.json.clone())
}

#[derive(Deserialize, Default)]
pub struct RemoveQuery {
    #[serde(default)]
    force: bool,
}

pub async fn remove(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(name): Path<String>,
    Query(q): Query<RemoveQuery>
) -> Result<StatusCode, AgentError> {
    let result = state.docker.remove_volume(&name, q.force).await;
    let action = Action {
        kind: "volume_remove",
        done: format!("Removed volume {name}"),
        failed: format!("Couldn't remove volume {name}"),
        subject: name,
        service: None,
    };
    record_action(&state, &by, action, &result);
    result.map(|()| StatusCode::NO_CONTENT)
}
