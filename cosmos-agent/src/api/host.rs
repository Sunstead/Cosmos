use crate::{ api::CachedJson, sse, state::AppState };
use axum::{ extract::State, response::sse::{ Event, Sse }, response::IntoResponse };
use futures_util::Stream;
use std::convert::Infallible;

/// Returns the newest sample. No collection, no serialization — both already
/// happened on the sampler thread.
pub async fn current(State(state): State<AppState>) -> impl IntoResponse {
    CachedJson(state.host_rx.borrow().json.clone())
}

pub async fn stream(
    State(state): State<AppState>
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    sse::stream_watch(state.host_rx.clone(), |snap| snap.json.clone(), state.shutdown.clone())
}
