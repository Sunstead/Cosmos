//! Bearer-token auth, who the caller is, the write gate, and CORS.

use crate::{ error::AgentError, state::AppState };
use axum::{
    extract::{ Query, Request, State },
    http::{ header, HeaderMap, HeaderValue, Method, Uri },
    middleware::Next,
    response::Response,
};
use serde::Deserialize;
use std::{ sync::Arc, time::Duration };
use tower_http::cors::{ AllowOrigin, CorsLayer };

/// What a caller may do once authenticated. The node-level `allow_actions`
/// still has to be on for an admin to change anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Admin,
    // The shared token can only ever be an admin. Viewers arrive with OIDC,
    // which maps groups to roles.
    #[allow(dead_code)]
    Viewer,
}

/// The authenticated caller, inserted into request extensions by
/// `require_auth`. Handlers that act on something take it as an
/// `Extension<Principal>` so the log says who did it.
#[derive(Debug, Clone)]
pub struct Principal {
    /// Stable identifier, for logs.
    pub subject: String,
    /// Human-readable, for the UI.
    pub name: String,
    pub role: Role,
}

impl Principal {
    pub fn is_admin(&self) -> bool {
        self.role == Role::Admin
    }

    /// The shared token is all-or-nothing, so its holder is an admin.
    fn token_holder() -> Self {
        Self { subject: "token".into(), name: "Token".into(), role: Role::Admin }
    }

    /// `allow_anonymous` means "anyone who can reach the port", deliberately.
    fn anonymous() -> Self {
        Self { subject: "anonymous".into(), name: "Anonymous".into(), role: Role::Admin }
    }
}

#[derive(Clone)]
pub struct Auth(Arc<AuthInner>);

struct AuthInner {
    token: Option<Box<[u8]>>,
    allow_query: bool,
}

impl Auth {
    pub fn new(token: Option<String>, allow_query: bool) -> Self {
        Self(
            Arc::new(AuthInner {
                token: token.map(|t| t.into_bytes().into_boxed_slice()),
                allow_query,
            })
        )
    }

    pub fn required(&self) -> bool {
        self.0.token.is_some()
    }

    /// `None` means "not authenticated". With no token configured every
    /// caller is let in, which is the correct reading of an agent that was
    /// explicitly opened up; the agent refuses to start that way otherwise.
    pub fn authenticate(&self, presented: Option<&str>) -> Option<Principal> {
        match &self.0.token {
            None => Some(Principal::anonymous()),
            Some(expected) =>
                presented
                    .filter(|p| ct_eq(p.as_bytes(), expected))
                    .map(|_| Principal::token_holder()),
        }
    }
}

/// Constant-time comparison. A plain `==` short-circuits at the first
/// differing byte, which leaks the token prefix to anyone able to measure
/// response latency across enough requests.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Deserialize, Default)]
struct TokenQuery {
    token: Option<String>,
}

/// Extracts a token from the `Authorization` header, falling back to
/// `?token=` when enabled.
///
/// The fallback exists because browser `EventSource` and `WebSocket` cannot
/// set request headers, and the web build is a supported target. Query tokens
/// do leak into access and proxy logs, so the trace layer is configured to
/// record `uri.path()` only, and the agent never issues redirects (which would
/// leak via `Referer`).
fn presented_token(headers: &HeaderMap, uri: &Uri, allow_query: bool) -> Option<String> {
    let header_token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned);

    if header_token.is_some() || !allow_query {
        return header_token;
    }
    Query::<TokenQuery>::try_from_uri(uri).ok()?.0.token
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next
) -> Result<Response, AgentError> {
    let principal = principal_from_parts(&state, req.headers(), req.uri()).ok_or(
        AgentError::Unauthorized
    )?;
    req.extensions_mut().insert(principal);
    Ok(next.run(req).await)
}

/// Identifies the caller without gating the request, for `/v1/info`, which
/// answers unauthenticated but reveals a little more once it knows who's
/// asking.
pub fn principal_from_parts(state: &AppState, headers: &HeaderMap, uri: &Uri) -> Option<Principal> {
    let presented = presented_token(headers, uri, state.auth.0.allow_query);
    state.auth.authenticate(presented.as_deref())
}

/// Separate from `require_auth` and applied only to the mutating sub-router,
/// so a node can be deployed read-only and a mistake in layer ordering can't
/// silently open it up.
pub async fn require_write(
    State(state): State<AppState>,
    req: Request,
    next: Next
) -> Result<Response, AgentError> {
    let principal = req.extensions().get::<Principal>().cloned();
    write_allowed(state.cfg.allow_actions, principal.as_ref())?;

    // One audit line per change, whoever made it. Path only, as in the trace
    // layer: the query string may carry a token.
    let (method, path) = (req.method().clone(), req.uri().path().to_owned());
    let res = next.run(req).await;
    if let Some(p) = principal {
        tracing::info!(
            by = %p.subject,
            name = %p.name,
            %method,
            %path,
            status = res.status().as_u16(),
            "action"
        );
    }
    Ok(res)
}

/// Both keys have to turn: the node allows actions at all, and the caller
/// is an admin. A missing principal means a layer-ordering mistake, and
/// fails closed.
fn write_allowed(allow_actions: bool, principal: Option<&Principal>) -> Result<(), AgentError> {
    if !allow_actions {
        return Err(AgentError::ReadOnly);
    }
    match principal {
        Some(p) if p.is_admin() => Ok(()),
        _ => Err(AgentError::Forbidden("this needs an admin".into())),
    }
}

/// The Tauri webview's origin differs per platform, and the Vite dev server
/// has its own. Anything else has to be opted into by config.
pub fn cors(cfg: &crate::config::Config) -> CorsLayer {
    const BUILT_IN: [&str; 5] = [
        "tauri://localhost", // macOS / iOS WKWebView
        "http://tauri.localhost", // Windows WebView2 / Android
        "https://tauri.localhost",
        "http://localhost:1420", // vite dev
        "http://127.0.0.1:1420",
    ];

    let mut origins: Vec<HeaderValue> = BUILT_IN.iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    origins.extend(cfg.cors.extra_origins.iter().filter_map(|o| o.parse().ok()));
    if cfg.cors.allow_null_origin {
        origins.push(HeaderValue::from_static("null"));
    }

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        // Must stay false: we authenticate with a bearer token, not cookies,
        // and `true` is incompatible with an origin list in some browsers.
        .allow_credentials(false)
        .max_age(Duration::from_secs(600))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_absent_and_truncated_tokens() {
        let auth = Auth::new(Some("s3cret".into()), true);
        assert!(auth.authenticate(Some("s3cret")).is_some_and(|p| p.is_admin()));
        assert!(auth.authenticate(Some("wrong")).is_none());
        assert!(auth.authenticate(None).is_none());
        // A prefix must not pass — this is what the length check guards.
        assert!(auth.authenticate(Some("s3cre")).is_none());
        assert!(auth.authenticate(Some("s3cretx")).is_none());
    }

    #[test]
    fn anonymous_mode_accepts_anything() {
        let auth = Auth::new(None, false);
        assert!(!auth.required());
        assert!(auth.authenticate(None).is_some());
        assert!(auth.authenticate(Some("whatever")).is_some());
    }

    fn principal(role: Role) -> Principal {
        Principal { subject: "s".into(), name: "n".into(), role }
    }

    #[test]
    fn writes_need_both_the_node_switch_and_an_admin() {
        let admin = principal(Role::Admin);
        let viewer = principal(Role::Viewer);
        assert!(write_allowed(true, Some(&admin)).is_ok());
        assert!(matches!(write_allowed(false, Some(&admin)), Err(AgentError::ReadOnly)));
        assert!(matches!(write_allowed(true, Some(&viewer)), Err(AgentError::Forbidden(_))));
        // No principal at all means the auth layer didn't run: fail closed.
        assert!(matches!(write_allowed(true, None), Err(AgentError::Forbidden(_))));
    }

    #[test]
    fn constant_time_compare_is_correct_for_edge_cases() {
        assert!(ct_eq(b"", b""));
        assert!(!ct_eq(b"a", b""));
        assert!(!ct_eq(b"", b"a"));
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
    }

    fn presented_for(header: Option<&str>, uri: &str, allow_query: bool) -> Option<String> {
        let mut headers = HeaderMap::new();
        if let Some(h) = header {
            headers.insert(header::AUTHORIZATION, h.parse().unwrap());
        }
        presented_token(&headers, &uri.parse().unwrap(), allow_query)
    }

    #[test]
    fn header_token_is_preferred_over_query() {
        assert_eq!(
            presented_for(Some("Bearer from-header"), "/v1/host?token=from-query", true).as_deref(),
            Some("from-header")
        );
    }

    #[test]
    fn query_token_is_read_only_when_enabled() {
        assert_eq!(presented_for(None, "/v1/host/stream?token=abc", true).as_deref(), Some("abc"));
        assert_eq!(
            presented_for(None, "/v1/host/stream?token=abc", false),
            None,
            "disabled means header-only"
        );
    }

    #[test]
    fn a_non_bearer_authorization_header_is_ignored() {
        assert_eq!(presented_for(Some("Basic dXNlcjpwYXNz"), "/v1/host", false), None);
    }
}
