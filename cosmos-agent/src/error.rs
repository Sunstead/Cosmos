//! One error type for every handler, rendered as a typed JSON envelope.
//!
//! The point is that a client can tell "Docker is down" from "there are no
//! containers" — the old agent returned an empty list for both.

use axum::{ http::StatusCode, response::{ IntoResponse, Response }, Json };
use cosmos_common::types::{ ApiError, ErrorCode };

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("{0}")] BadRequest(String),

    #[error("missing or invalid token")] Unauthorized,

    #[error("{0}")] Forbidden(String),

    #[error("this agent is configured read-only")] ReadOnly,

    #[error("container {0} not found")] ContainerNotFound(String),

    #[error("docker is unavailable: {0}")] DockerUnavailable(String),

    #[error("{action} failed: {source}")] ActionFailed {
        action: &'static str,
        #[source] source: bollard::errors::Error,
    },

    /// Disabled in config. The client should hide the feature rather than
    /// retry it.
    #[error("{0} is not enabled on this agent")] NotEnabled(&'static str),

    /// Configured but not working right now. The client should retry.
    #[error("{0}")] Unavailable(String),

    #[error("internal error")] Internal(#[source] anyhowless::Source),
}

/// A tiny stand-in for `anyhow::Error` so the crate doesn't take the
/// dependency for a single variant.
pub mod anyhowless {
    pub type Source = Box<dyn std::error::Error + Send + Sync + 'static>;
}

impl AgentError {
    pub fn internal<E>(e: E) -> Self where E: std::error::Error + Send + Sync + 'static {
        Self::Internal(Box::new(e))
    }

    fn code(&self) -> ErrorCode {
        match self {
            Self::BadRequest(_) => ErrorCode::BadRequest,
            Self::Unauthorized => ErrorCode::Unauthorized,
            Self::Forbidden(_) => ErrorCode::Forbidden,
            Self::ReadOnly => ErrorCode::ReadOnly,
            Self::ContainerNotFound(_) => ErrorCode::ContainerNotFound,
            Self::DockerUnavailable(_) => ErrorCode::DockerUnavailable,
            Self::ActionFailed { .. } => ErrorCode::ActionFailed,
            Self::NotEnabled(_) => ErrorCode::NotEnabled,
            Self::Unavailable(_) => ErrorCode::Unavailable,
            Self::Internal(_) => ErrorCode::Internal,
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) | Self::ReadOnly => StatusCode::FORBIDDEN,
            Self::ContainerNotFound(_) => StatusCode::NOT_FOUND,
            Self::ActionFailed { .. } => StatusCode::CONFLICT,
            // 501 vs 503 is load-bearing: the client hides a feature on 501
            // and shows a retry on 503.
            Self::NotEnabled(_) => StatusCode::NOT_IMPLEMENTED,
            Self::DockerUnavailable(_) | Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AgentError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code();

        // Internal errors get the source chain in the log and a bare message
        // on the wire; everything else is safe to show the caller verbatim.
        let (message, detail) = match &self {
            Self::Internal(source) => {
                tracing::error!(error = %source, "internal error");
                ("internal error".to_string(), None)
            }
            other => {
                tracing::debug!(?code, error = %other, "request failed");
                let detail = match other {
                    Self::ActionFailed { source, .. } => Some(source.to_string()),
                    _ => None,
                };
                (other.to_string(), detail)
            }
        };

        let mut res = (status, Json(ApiError { code, message, detail })).into_response();

        if matches!(self, Self::Unauthorized) {
            res.headers_mut().insert(
                axum::http::header::WWW_AUTHENTICATE,
                axum::http::HeaderValue::from_static("Bearer")
            );
        }
        res
    }
}

/// Maps a bollard failure to the right code. A 404 from Docker means the
/// container is gone, which is a different thing from Docker being down.
pub fn from_docker(action: &'static str, id: &str, source: bollard::errors::Error) -> AgentError {
    match &source {
        bollard::errors::Error::DockerResponseServerError { status_code: 404, .. } =>
            AgentError::ContainerNotFound(id.to_string()),
        bollard::errors::Error::DockerResponseServerError { status_code: 304, .. } =>
            // "already started" / "already stopped" — the caller's intent is
            // satisfied, so this is not an error.
            AgentError::ActionFailed { action, source },
        _ => AgentError::ActionFailed { action, source },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_enabled_and_unavailable_map_to_different_statuses() {
        // The client keys "hide this feature" vs "retry later" off these.
        assert_eq!(AgentError::NotEnabled("history").status(), StatusCode::NOT_IMPLEMENTED);
        assert_eq!(
            AgentError::Unavailable("x".into()).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[test]
    fn read_only_is_forbidden_not_unauthorized() {
        // 401 would make the client think its token was wrong and re-prompt.
        assert_eq!(AgentError::ReadOnly.status(), StatusCode::FORBIDDEN);
        assert_eq!(AgentError::ReadOnly.code(), ErrorCode::ReadOnly);
    }

    #[test]
    fn missing_container_is_404_not_503() {
        assert_eq!(
            AgentError::ContainerNotFound("abc".into()).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            AgentError::DockerUnavailable("x".into()).status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
    }
}
