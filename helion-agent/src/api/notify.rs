use crate::{
    api::{ record_action, Action },
    auth::Principal,
    error::AgentError,
    notify::{ self, db, NotifyHandle },
    state::AppState,
};
use axum::{ extract::{ Path, State }, http::StatusCode, Extension, Json };
use cosmos_common::types::{ ChannelStatus, NotifyChannel, NotifyChannelInput, NotifyResponse, NotifySettings };

fn handle(state: &AppState) -> Result<&NotifyHandle, AgentError> {
    state.notify.as_ref().ok_or(AgentError::NotEnabled("notifications"))
}

fn channel_action(kind: &'static str, name: &str, done: &str, failed: &str) -> Action {
    Action {
        kind,
        subject: name.to_string(),
        service: None,
        done: format!("{done} notification channel {name}"),
        failed: format!("{failed} notification channel {name}"),
    }
}

/// Admins only: channel addresses and topics aren't for every viewer.
pub async fn get(
    State(state): State<AppState>,
    Extension(principal): Extension<Principal>
) -> Result<Json<NotifyResponse>, AgentError> {
    let notify = handle(&state)?;
    if !principal.is_admin() {
        return Err(AgentError::Forbidden("this needs an admin".into()));
    }
    notify.response().await.map(Json)
}

pub async fn create(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<NotifyChannelInput>
) -> Result<(StatusCode, Json<NotifyChannel>), AgentError> {
    let notify = handle(&state)?;
    let channel = notify::validate(input, 0, None)?;
    let action = channel_action("notify_channel_create", &channel.name, "Added", "Couldn't add");
    let result = notify.store.call(move |c| db::insert(c, &channel)).await;
    record_action(&state, &by, action, &result);
    let saved = result?;
    notify.reload().await?;
    Ok((StatusCode::CREATED, Json(saved.public(ChannelStatus::default()))))
}

pub async fn update(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(id): Path<String>,
    Json(input): Json<NotifyChannelInput>
) -> Result<Json<NotifyChannel>, AgentError> {
    let notify = handle(&state)?;
    let lookup = id.clone();
    let saved = notify.store.call(move |c| db::get(c, &lookup)).await?;
    let channel = notify::validate(input, saved.id, saved.secret)?;
    let public = channel.public(ChannelStatus::default());
    let action = channel_action("notify_channel_update", &channel.name, "Edited", "Couldn't edit");
    let result = notify.store.call(move |c| db::update(c, &channel)).await;
    record_action(&state, &by, action, &result);
    result?;
    notify.reload().await?;
    Ok(Json(public))
}

pub async fn remove(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Path(id): Path<String>
) -> Result<StatusCode, AgentError> {
    let notify = handle(&state)?;
    let lookup = id.clone();
    let name = notify.store
        .call(move |c| db::get(c, &lookup)).await
        .map_or_else(|_| id.clone(), |c| c.name);
    let action = channel_action("notify_channel_delete", &name, "Removed", "Couldn't remove");
    let result = notify.store.call(move |c| db::delete(c, &id)).await;
    record_action(&state, &by, action, &result);
    result?;
    notify.reload().await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends a test message whatever the channel's rules, and answers with how
/// it went. A delivery failure is a 503 carrying the reason.
pub async fn test(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, AgentError> {
    let notify = handle(&state)?;
    let channel = notify.store.call(move |c| db::get(c, &id)).await?;
    notify
        .test(&channel).await
        .map(|()| StatusCode::NO_CONTENT)
        .map_err(|e| AgentError::Unavailable(format!("{} didn't take it: {e}", channel.name)))
}

pub async fn settings(
    State(state): State<AppState>,
    Extension(by): Extension<Principal>,
    Json(input): Json<NotifySettings>
) -> Result<Json<NotifySettings>, AgentError> {
    let notify = handle(&state)?;
    let settings = notify::validate_settings(input)?;
    let saved = settings.clone();
    let result = notify.store.call(move |c| db::save_settings(c, &settings)).await;
    let action = Action {
        kind: "notify_settings",
        subject: "notifications".into(),
        service: None,
        done: "Changed the notification settings".into(),
        failed: "Couldn't change the notification settings".into(),
    };
    record_action(&state, &by, action, &result);
    result?;
    notify.reload().await?;
    Ok(Json(saved))
}
