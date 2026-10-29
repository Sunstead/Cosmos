use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// Machine-readable failure reason. The client keys retry behaviour off this,
/// not off the HTTP status, so the split between "this agent will never do
/// that" and "this agent can't do that right now" has to be explicit.
#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadRequest,
    Unauthorized,
    /// Action refused on principle — e.g. stopping the agent's own container.
    Forbidden,
    /// This agent is configured read-only; don't offer the action again.
    ReadOnly,
    NotFound,
    ContainerNotFound,
    /// Docker is configured but unreachable right now. Retry.
    DockerUnavailable,
    /// Docker accepted the request and refused it (already stopped, etc.).
    ActionFailed,
    /// Feature disabled in config. Hide it; retrying will never help.
    NotEnabled,
    /// Configured but currently failing. Show a retry affordance.
    Unavailable,
    Internal,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
    pub detail: Option<String>,
}
