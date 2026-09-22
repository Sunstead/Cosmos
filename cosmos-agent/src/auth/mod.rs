//! Who the caller is, the write gate, and CORS.
//!
//! Callers present an OIDC access token (see `oidc`) as a bearer token. The
//! only other mode is `allow_anonymous`, for local development.

pub mod oidc;

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

    /// `allow_anonymous` means "anyone who can reach the port", deliberately.
    fn anonymous() -> Self {
        Self { subject: "anonymous".into(), name: "Anonymous".into(), role: Role::Admin }
    }
}

#[derive(Clone)]
pub struct Auth {
    mode: Arc<Mode>,
    allow_query: bool,
}

enum Mode {
    /// Explicitly opened up. The agent refuses to start this way unless
    /// `allow_anonymous` is set.
    Anonymous,
    Oidc(Arc<oidc::OidcVerifier>),
}

impl Auth {
    pub fn anonymous(allow_query: bool) -> Self {
        Self { mode: Arc::new(Mode::Anonymous), allow_query }
    }

    /// Starts loading the provider's keys in the background.
    pub fn oidc(cfg: &crate::config::OidcConfig, allow_query: bool) -> Self {
        let verifier = Arc::new(oidc::OidcVerifier::new(cfg));
        verifier.spawn_refresh();
        Self { mode: Arc::new(Mode::Oidc(verifier)), allow_query }
    }

    pub fn required(&self) -> bool {
        !matches!(*self.mode, Mode::Anonymous)
    }

    /// `Ok(None)` is "not authenticated". `Err` is "can't tell right now"
    /// (the provider is unreachable), which must not look like a bad token,
    /// or the app would send the user back through sign-in for nothing.
    pub async fn authenticate(&self, presented: Option<&str>) -> Result<Option<Principal>, AgentError> {
        match &*self.mode {
            Mode::Anonymous => Ok(Some(Principal::anonymous())),
            Mode::Oidc(verifier) => {
                let Some(token) = presented else {
                    return Ok(None);
                };
                match verifier.verify(token).await {
                    Ok(p) => Ok(Some(p)),
                    Err(oidc::VerifyError::Invalid(reason)) => {
                        tracing::debug!(%reason, "rejected token");
                        Ok(None)
                    }
                    Err(oidc::VerifyError::Unavailable(reason)) => Err(AgentError::Unavailable(reason)),
                }
            }
        }
    }
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
    let principal = principal_from_parts(&state, req.headers(), req.uri()).await?.ok_or(
        AgentError::Unauthorized
    )?;
    req.extensions_mut().insert(principal);
    Ok(next.run(req).await)
}

/// Identifies the caller without gating the request, for `/v1/info`, which
/// answers unauthenticated but reveals a little more once it knows who's
/// asking.
pub async fn principal_from_parts(
    state: &AppState,
    headers: &HeaderMap,
    uri: &Uri
) -> Result<Option<Principal>, AgentError> {
    let presented = presented_token(headers, uri, state.auth.allow_query);
    state.auth.authenticate(presented.as_deref()).await
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

    #[tokio::test]
    async fn anonymous_mode_lets_anyone_in_as_admin() {
        let auth = Auth::anonymous(false);
        assert!(!auth.required());
        assert!(auth.authenticate(None).await.unwrap().is_some_and(|p| p.is_admin()));
    }

    #[tokio::test]
    async fn oidc_mode_needs_a_valid_token() {
        let p = oidc::tests::provider("k1").await;
        let cfg = crate::config::OidcConfig {
            issuer: p.issuer.clone(),
            client_id: "cosmos".into(),
            audience: None,
            discovery_url: None,
            admin_groups: vec!["homelab-admins".into()],
            scopes: "openid".into(),
        };
        let auth = Auth::oidc(&cfg, true);
        assert!(auth.required());
        assert!(auth.authenticate(None).await.unwrap().is_none());
        assert!(auth.authenticate(Some("junk")).await.unwrap().is_none());

        let token = oidc::tests::token("k1", oidc::tests::claims(&p.issuer, &["homelab-admins"]));
        let who = auth.authenticate(Some(&token)).await.unwrap().unwrap();
        assert!(who.is_admin());
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
