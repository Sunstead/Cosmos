use crate::{ auth, state::AppState };
use axum::{ extract::{ OriginalUri, State }, http::HeaderMap, Json };
use cosmos_common::types::AgentInfo;

pub async fn healthz() -> &'static str {
    "ok"
}

/// Unauthenticated, and minimal by design.
///
/// The desktop app needs to tell "nothing is listening at this address" from
/// "an agent is here and it wants a token" *before* it has a token, or the
/// add-node flow can't give a useful error. So this route answers either way —
/// but `node_name` stays `None` until the caller proves itself, so an
/// unauthenticated scan can't harvest the names of machines on the network.
pub async fn info(
    State(state): State<AppState>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri
) -> Json<AgentInfo> {
    let authenticated = auth::verify_parts(&state, &headers, &uri);

    Json(AgentInfo {
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
        api_version: 1,
        auth_required: state.auth.required(),
        node_name: authenticated.then(|| state.facts.node_name.clone()),
        capabilities: state.capabilities(),
    })
}
