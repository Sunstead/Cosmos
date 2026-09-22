use crate::{
    api::CachedJson,
    auth::Principal,
    error::AgentError,
    sample::{ filters::HostFilters, wol::WolHandle },
    state::AppState,
    store,
    wol,
};
use axum::{ extract::{ Path, State }, http::StatusCode, Extension, Json };
use cosmos_common::types::{ WolEntry, WolNeighborsResponse, WolTarget, WolTargetInput };

fn handle(state: &AppState) -> Result<&WolHandle, AgentError> {
    state.wol.as_ref().ok_or(AgentError::NotEnabled("wake-on-lan"))
}

pub async fn list(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    Ok(CachedJson(handle(&state)?.rx.borrow().json.clone()))
}

/// Read on request rather than sampled: it's one small file, only admins
/// can ask, and only while adding a target.
pub async fn neighbors(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>
) -> Result<Json<WolNeighborsResponse>, AgentError> {
    handle(&state)?;
    if !principal.is_admin() {
        return Err(AgentError::Forbidden("this needs an admin".into()));
    }
    let filters = HostFilters::from_config(&state.cfg.host);
    let neighbors = wol::neighbors(|iface| filters.iface_allowed(iface)).await?;
    Ok(Json(WolNeighborsResponse { neighbors }))
}

pub async fn create(
    State(state): State<AppState>,
    Json(input): Json<WolTargetInput>
) -> Result<(StatusCode, Json<WolTarget>), AgentError> {
    let wol = handle(&state)?;
    let target = wol::validate(input, String::new())?;
    let saved = wol.store.call(move |c| store::insert_target(c, &target)).await?;
    wol.reload().await?;
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<WolTargetInput>
) -> Result<Json<WolTarget>, AgentError> {
    let wol = handle(&state)?;
    let target = wol::validate(input, id)?;
    let saved = target.clone();
    wol.store.call(move |c| store::update_target(c, &target)).await?;
    wol.reload().await?;
    Ok(Json(saved))
}

pub async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>
) -> Result<StatusCode, AgentError> {
    let wol = handle(&state)?;
    wol.store.call(move |c| store::delete_target(c, &id)).await?;
    wol.reload().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends the packet, then hands the target to the sampler to watch it come
/// up. Returns the entry already in `waking`.
pub async fn wake(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Extension(principal): Extension<Principal>
) -> Result<Json<WolEntry>, AgentError> {
    let wol = handle(&state)?;
    let lookup = id.clone();
    let target = wol.store.call(move |c| store::get_target(c, &lookup)).await?.target;

    let to = wol::send(&target).await?;
    tracing::info!(target = %target.name, mac = %target.mac, %to, by = %principal.name, "sent magic packet");

    wol.waking(id.clone(), principal.name).await?;
    wol.entry(&id).map(Json).ok_or_else(|| AgentError::NotFound(format!("no target {id}")))
}
