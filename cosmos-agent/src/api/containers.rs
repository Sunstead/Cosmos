use crate::{ api::CachedJson, error::AgentError, sse, state::AppState };
use axum::{
    extract::{ Path, Query, State },
    response::sse::{ Event, Sse },
    Json,
};
use cosmos_common::types::{ ContainerActionRequest, ContainerActionResult };
use futures_util::Stream;
use serde::Deserialize;
use std::convert::Infallible;

pub async fn list(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    // If Docker is unreachable, say so. The old agent returned an empty list,
    // which the UI could not distinguish from "this host runs no containers".
    state.docker.require()?;
    Ok(CachedJson(state.containers_rx.borrow().json.clone()))
}

pub async fn stream(
    State(state): State<AppState>
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    sse::stream_watch(state.containers_rx.clone(), |snap| snap.json.clone())
}

/// `timeout_secs` is optional in the body; an absent body is fine too.
fn timeout_of(body: Option<Json<ContainerActionRequest>>) -> Option<u32> {
    body.and_then(|Json(b)| b.timeout_secs)
}

pub async fn start(
    State(state): State<AppState>,
    Path(id): Path<String>
) -> Result<Json<ContainerActionResult>, AgentError> {
    state.docker.start(&id).await.map(Json)
}

pub async fn stop(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<ContainerActionRequest>>
) -> Result<Json<ContainerActionResult>, AgentError> {
    state.docker.stop(&id, timeout_of(body)).await.map(Json)
}

pub async fn restart(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Option<Json<ContainerActionRequest>>
) -> Result<Json<ContainerActionResult>, AgentError> {
    state.docker.restart(&id, timeout_of(body)).await.map(Json)
}

#[derive(Deserialize, Default)]
pub struct RemoveQuery {
    #[serde(default)]
    force: bool,
    /// Also remove anonymous volumes attached to the container.
    #[serde(default)]
    volumes: bool,
}

pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<RemoveQuery>
) -> Result<Json<ContainerActionResult>, AgentError> {
    state.docker.remove(&id, q.force, q.volumes).await.map(Json)
}
