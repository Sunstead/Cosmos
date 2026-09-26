use crate::{
    api::{ record_action, Action, CachedJson },
    auth::Principal,
    backups,
    error::AgentError,
    state::AppState,
};
use axum::{ extract::State, http::StatusCode, Extension, Json };
use cosmos_common::types::{ BackupRequestKind, BackupRunInput };

pub async fn current(State(state): State<AppState>) -> Result<CachedJson, AgentError> {
    let rx = state.backups_rx.as_ref().ok_or(AgentError::NotEnabled("backups"))?;
    Ok(CachedJson(rx.borrow().json.clone()))
}

/// Asks the host to back up now, or to run the restore test. The host's
/// dispatcher does the work; the result shows up in `requests` on
/// `/v1/backups`. The state-only backup is for updates, not this route.
pub async fn run(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<BackupRunInput>
) -> Result<(StatusCode, Json<serde_json::Value>), AgentError> {
    state.backups_rx.as_ref().ok_or(AgentError::NotEnabled("backups"))?;
    let dir = state.cfg.backups.requests_dir.clone().ok_or(AgentError::NotEnabled("backup requests"))?;
    let (subject, done, failed) = match input.kind {
        BackupRequestKind::Backup => ("backup", "Started a backup", "Couldn't start a backup"),
        BackupRequestKind::RestoreTest => ("restore test", "Started a restore test", "Couldn't start a restore test"),
        BackupRequestKind::BackupState => {
            return Err(AgentError::BadRequest("only a backup or a restore test can be started here".into()));
        }
    };
    let who = by.name.clone();
    let result = tokio::task::spawn_blocking(move || backups::request(&dir, input.kind, &who)).await.map_err(
        AgentError::internal
    )?;
    let action = Action {
        kind: "backup_run",
        subject: subject.into(),
        service: None,
        done: done.into(),
        failed: failed.into(),
    };
    record_action(&state, &by, action, &result);
    let id = result?;
    tracing::info!(%id, kind = input.kind.file_name(), by = %by.name, "requested from the host");
    if let Some(poke) = &state.backups_poke {
        poke.notify_one();
    }
    Ok((StatusCode::ACCEPTED, Json(serde_json::json!({ "id": id }))))
}
