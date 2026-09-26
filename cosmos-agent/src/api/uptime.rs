use crate::{
    api::{ record_action, Action, CachedJson },
    auth::Principal,
    error::AgentError,
    state::AppState,
    uptime::{ self, db, UptimeHandle },
};
use axum::{ extract::{ Path, State }, http::StatusCode, Extension, Json };
use cosmos_common::types::{ UptimeCheckInput, UptimeEntry, UptimeServiceInput };

fn handle(state: &AppState) -> Result<&UptimeHandle, AgentError> {
    state.uptime.as_ref().ok_or(AgentError::NotEnabled("uptime checks"))
}

fn entry(uptime: &UptimeHandle, id: &str) -> Result<Json<UptimeEntry>, AgentError> {
    uptime.entry(id).map(Json).ok_or_else(|| AgentError::NotFound(format!("no check {id}")))
}

fn check_action(kind: &'static str, name: &str, done: &str, failed: &str) -> Action {
    Action {
        kind,
        subject: name.to_string(),
        service: None,
        done: format!("{done} the uptime check {name}"),
        failed: format!("{failed} the uptime check {name}"),
    }
}

pub async fn list(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    Ok(CachedJson(handle(&state)?.rx.borrow().json.clone()))
}

/// Answers once the new check has run, so the form can show whether it works.
pub async fn create(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<UptimeCheckInput>
) -> Result<(StatusCode, Json<UptimeEntry>), AgentError> {
    let uptime = handle(&state)?;
    let check = uptime::validate(input, 0, uptime.default_interval)?;
    let action = check_action("uptime_check_create", &check.name, "Added", "Couldn't add");
    let result = uptime.store.call(move |c| db::insert(c, &check)).await;
    record_action(&state, &by, action, &result);
    let id = result?.id.to_string();
    uptime.reload(Some(id.clone())).await?;
    Ok((StatusCode::CREATED, entry(uptime, &id)?))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(id): Path<String>,
    Json(input): Json<UptimeCheckInput>
) -> Result<Json<UptimeEntry>, AgentError> {
    let uptime = handle(&state)?;
    let check = uptime::validate(input, db::parse_id(&id)?, uptime.default_interval)?;
    let action = check_action("uptime_check_update", &check.name, "Edited", "Couldn't edit");
    let result = uptime.store.call(move |c| db::update(c, &check)).await;
    record_action(&state, &by, action, &result);
    result?;
    uptime.reload(Some(id.clone())).await?;
    entry(uptime, &id)
}

pub async fn remove(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(id): Path<String>
) -> Result<StatusCode, AgentError> {
    let uptime = handle(&state)?;
    let row = db::parse_id(&id)?;
    let name = uptime.entry(&id).map_or_else(|| id.clone(), |e| e.check.name);
    let action = check_action("uptime_check_delete", &name, "Removed", "Couldn't remove");
    let result = uptime.store.call(move |c| db::delete(c, row)).await;
    record_action(&state, &by, action, &result);
    result?;
    uptime.reload(None).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A service's own check: turn it off, or change the path or what counts
/// as up.
pub async fn service(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(service): Path<String>,
    Json(input): Json<UptimeServiceInput>
) -> Result<Json<UptimeEntry>, AgentError> {
    let uptime = handle(&state)?;
    let id = format!("svc:{service}");
    uptime.entry(&id).ok_or_else(|| AgentError::NotFound(format!("{service} has no uptime check")))?;
    let input = uptime::validate_service(input)?;
    let action = Action {
        kind: "uptime_service_update",
        subject: service.clone(),
        service: Some(service.clone()),
        done: format!("Changed the uptime check for {service}"),
        failed: format!("Couldn't change the uptime check for {service}"),
    };
    let saved = service.clone();
    let result = uptime.store.call(move |c| db::save_service(c, &saved, &input)).await;
    record_action(&state, &by, action, &result);
    result?;
    uptime.reload(Some(id.clone())).await?;
    entry(uptime, &id)
}
