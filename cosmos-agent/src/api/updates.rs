use crate::{
    api::{ record_action, Action, CachedJson },
    auth::Principal,
    error::AgentError,
    state::AppState,
    updates::UpdatesHandle,
};
use axum::{ extract::State, http::StatusCode, Extension, Json };
use cosmos_common::types::{ UpdateApplyInput, UpdatePolicyInput, UpdateRun, UpdateRunKind, UpdateUnitInput };

fn handle(state: &AppState) -> Result<&UpdatesHandle, AgentError> {
    state.updates.as_ref().ok_or(AgentError::NotEnabled("updates"))
}

pub async fn list(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    Ok(CachedJson(handle(&state)?.rx.borrow().json.clone()))
}

/// Checks the registries now; answers with the new list.
pub async fn check(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    let updates = handle(&state)?;
    updates.check().await?;
    Ok(CachedJson(updates.rx.borrow().json.clone()))
}

async fn start(
    state: &AppState,
    by: &Principal,
    unit: String,
    tag: Option<String>,
    kind: UpdateRunKind
) -> Result<(StatusCode, Json<UpdateRun>), AgentError> {
    let updates = handle(state)?;
    let (verb, failed) = match kind {
        UpdateRunKind::Update => ("Started updating", "Couldn't start updating"),
        UpdateRunKind::Rollback => ("Started rolling back", "Couldn't start rolling back"),
    };
    let result = updates.apply(unit.clone(), tag.clone(), kind, by.name.clone()).await;
    let target = match (&result, &tag) {
        (Ok(run), _) => format!(" to {}", run.to),
        (Err(_), Some(t)) => format!(" to {t}"),
        (Err(_), None) => String::new(),
    };
    let action = Action {
        kind: if kind == UpdateRunKind::Update { "update_apply" } else { "update_rollback" },
        subject: unit.clone(),
        service: None,
        done: format!("{verb} {unit}{target}"),
        failed: format!("{failed} {unit}{target}"),
    };
    record_action(state, by, action, &result);
    Ok((StatusCode::ACCEPTED, Json(result?)))
}

pub async fn apply(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<UpdateApplyInput>
) -> Result<(StatusCode, Json<UpdateRun>), AgentError> {
    start(&state, &by, input.unit, Some(input.tag), UpdateRunKind::Update).await
}

pub async fn rollback(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<UpdateUnitInput>
) -> Result<(StatusCode, Json<UpdateRun>), AgentError> {
    start(&state, &by, input.unit, None, UpdateRunKind::Rollback).await
}

pub async fn policy(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<UpdatePolicyInput>
) -> Result<CachedJson, AgentError> {
    let updates = handle(&state)?;
    let result = updates.policy(input.unit.clone(), input.policy).await;
    let label = match input.policy {
        cosmos_common::types::UpdatePolicy::Manual => "manual",
        cosmos_common::types::UpdatePolicy::Patch => "patches automatically",
        cosmos_common::types::UpdatePolicy::Auto => "automatic",
    };
    let action = Action {
        kind: "update_policy",
        subject: input.unit.clone(),
        service: None,
        done: format!("Set updates for {} to {label}", input.unit),
        failed: format!("Couldn't change updates for {}", input.unit),
    };
    record_action(&state, &by, action, &result);
    result?;
    Ok(CachedJson(updates.rx.borrow().json.clone()))
}
