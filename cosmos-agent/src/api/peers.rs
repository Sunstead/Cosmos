use crate::{ api::CachedJson, error::AgentError, state::AppState };
use axum::{ extract::State, http::{ header, HeaderMap }, Json };
use cosmos_common::types::PeerHello;

/// 501 without `[[peers]]`, so the app hides the panel.
pub async fn list(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    let peers = state.peers.as_ref().ok_or(AgentError::NotEnabled("peers"))?;
    let json = peers.rx.borrow().json.clone();
    Ok(CachedJson(json))
}

/// Public, outside sign-in: a peer authenticates with the shared token, not
/// a person's session, so an identity provider restart doesn't read as a
/// node going down. It can only say "I'm alive".
pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(hello): Json<PeerHello>
) -> Result<Json<PeerHello>, AgentError> {
    let peers = state.peers.as_ref().ok_or(AgentError::NotEnabled("peers"))?;
    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    Ok(Json(peers.receive(presented, hello)?))
}
