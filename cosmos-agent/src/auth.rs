//! Bearer-token auth, the write gate, and CORS.

use crate::{ error::AgentError, state::AppState };
use axum::{
    extract::{ Query, Request, State },
    http::{ header, HeaderValue, Method },
    middleware::Next,
    response::Response,
};
use serde::Deserialize;
use std::{ sync::Arc, time::Duration };
use tower_http::cors::{ AllowOrigin, CorsLayer };

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

    pub fn verify(&self, presented: Option<&str>) -> bool {
        match &self.0.token {
            // Explicitly anonymous; the agent refuses to start in this mode
            // unless it was opted into.
            None => true,
            Some(expected) => presented.is_some_and(|p| ct_eq(p.as_bytes(), expected)),
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
fn presented_token(req: &Request, allow_query: bool) -> Option<String> {
    let header_token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned);

    if header_token.is_some() || !allow_query {
        return header_token;
    }
    Query::<TokenQuery>::try_from_uri(req.uri()).ok()?.0.token
}

pub async fn require_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next
) -> Result<Response, AgentError> {
    let presented = presented_token(&req, state.auth.0.allow_query);
    if state.auth.verify(presented.as_deref()) {
        Ok(next.run(req).await)
    } else {
        Err(AgentError::Unauthorized)
    }
}

/// Checks a token without gating the request, for `/v1/info` — which answers
/// unauthenticated but reveals a little more once it knows who's asking.
pub fn verify_parts(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    uri: &axum::http::Uri
) -> bool {
    let from_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_owned);

    let presented = match from_header {
        Some(t) => Some(t),
        None if state.auth.0.allow_query =>
            Query::<TokenQuery>::try_from_uri(uri)
                .ok()
                .and_then(|q| q.0.token),
        None => None,
    };

    // With no token configured every caller is "authenticated", which is the
    // correct reading of an agent that was explicitly opened up.
    if state.auth.required() { state.auth.verify(presented.as_deref()) } else { true }
}

/// Separate from `require_auth` and applied only to the mutating sub-router,
/// so a node can be deployed read-only and a mistake in layer ordering can't
/// silently open it up.
pub async fn require_write(
    State(state): State<AppState>,
    req: Request,
    next: Next
) -> Result<Response, AgentError> {
    if !state.cfg.docker.allow_actions {
        return Err(AgentError::ReadOnly);
    }
    Ok(next.run(req).await)
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
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
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
        assert!(auth.verify(Some("s3cret")));
        assert!(!auth.verify(Some("wrong")));
        assert!(!auth.verify(None));
        // A prefix must not pass — this is what the length check guards.
        assert!(!auth.verify(Some("s3cre")));
        assert!(!auth.verify(Some("s3cretx")));
    }

    #[test]
    fn anonymous_mode_accepts_anything() {
        let auth = Auth::new(None, false);
        assert!(!auth.required());
        assert!(auth.verify(None));
        assert!(auth.verify(Some("whatever")));
    }

    #[test]
    fn constant_time_compare_is_correct_for_edge_cases() {
        assert!(ct_eq(b"", b""));
        assert!(!ct_eq(b"a", b""));
        assert!(!ct_eq(b"", b"a"));
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
    }

    fn request_with(header: Option<&str>, uri: &str) -> Request {
        let mut builder = Request::builder().uri(uri);
        if let Some(h) = header {
            builder = builder.header(header::AUTHORIZATION, h);
        }
        builder.body(axum::body::Body::empty()).unwrap()
    }

    #[test]
    fn header_token_is_preferred_over_query() {
        let req = request_with(Some("Bearer from-header"), "/v1/host?token=from-query");
        assert_eq!(presented_token(&req, true).as_deref(), Some("from-header"));
    }

    #[test]
    fn query_token_is_read_only_when_enabled() {
        let req = request_with(None, "/v1/host/stream?token=abc");
        assert_eq!(presented_token(&req, true).as_deref(), Some("abc"));

        let req = request_with(None, "/v1/host/stream?token=abc");
        assert_eq!(presented_token(&req, false), None, "disabled means header-only");
    }

    #[test]
    fn a_non_bearer_authorization_header_is_ignored() {
        let req = request_with(Some("Basic dXNlcjpwYXNz"), "/v1/host");
        assert_eq!(presented_token(&req, false), None);
    }
}
