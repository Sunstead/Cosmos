//! The complete HTTP surface, in one screen.
//!
//! Keeping only the router here is deliberate: which routes exist, which
//! require a token, and which require the write gate should be auditable
//! without reading nine files.

mod backups;
mod containers;
mod host;
mod logs;
mod meta;
mod metrics;
mod tailnet;
mod volumes;
mod wol;
mod web;

use crate::{ auth, state::AppState };
use axum::{
    http::{ header, HeaderValue },
    middleware::from_fn_with_state,
    response::{ IntoResponse, Response },
    routing::{ delete, get, post, put },
    Router,
};
use std::sync::Arc;
use tower_http::{ compression::CompressionLayer, trace::TraceLayer };

pub fn router(state: AppState) -> Router {
    // Mutating routes. The write gate is applied here and nowhere else.
    let write = Router::new()
        .route("/v1/containers/:id/start", post(containers::start))
        .route("/v1/containers/:id/stop", post(containers::stop))
        .route("/v1/containers/:id/restart", post(containers::restart))
        .route("/v1/containers/:id", delete(containers::remove))
        .route("/v1/volumes/:name", delete(volumes::remove))
        .route("/v1/wol/targets", post(wol::create))
        .route("/v1/wol/targets/:id", put(wol::update).delete(wol::remove))
        .route("/v1/wol/targets/:id/wake", post(wol::wake))
        .layer(from_fn_with_state(state.clone(), auth::require_write));

    let read = Router::new()
        .route("/v1/host", get(host::current))
        .route("/v1/host/stream", get(host::stream))
        .route("/v1/containers", get(containers::list))
        .route("/v1/containers/stream", get(containers::stream))
        .route("/v1/containers/:id/logs", get(logs::tail))
        .route("/v1/containers/:id/logs/ws", get(logs::follow))
        .route("/v1/logs", get(logs::tail_all))
        .route("/v1/logs/ws", get(logs::follow_all))
        .route("/v1/volumes", get(volumes::list))
        .route("/v1/volumes/stream", get(volumes::stream))
        .route("/v1/backups", get(backups::current))
        .route("/v1/tailnet", get(tailnet::current))
        .route("/v1/wol", get(wol::list))
        // Admin-only inside the handler: it reveals the LAN's MAC addresses.
        .route("/v1/wol/neighbors", get(wol::neighbors))
        // Gzip only here. A history range can be tens of thousands of numbers;
        // compressing an SSE stream would break incremental delivery.
        .route("/v1/metrics", get(metrics::range).layer(CompressionLayer::new().gzip(true)));

    // `/v1/info` is intentionally unauthenticated so the desktop app can tell
    // "nothing is listening" from "an agent is here and wants a token" before
    // it has one. It reveals only the version and capability flags.
    let public = Router::new()
        .route("/healthz", get(meta::healthz))
        .route("/v1/info", get(meta::info));

    // The web UI, when bundled: public static files plus an SPA fallback.
    let web = state.cfg.web.dir.as_deref().and_then(web::router).unwrap_or_default();

    Router::new()
        .merge(read)
        .merge(write)
        .layer(from_fn_with_state(state.clone(), auth::require_auth))
        .merge(public)
        .merge(web)
        // Record the path, never the full URI: `?token=` must not reach the
        // logs. This is the mitigation that makes query tokens tolerable.
        .layer(
            TraceLayer::new_for_http().make_span_with(|req: &axum::http::Request<_>| {
                tracing::info_span!(
                    "request",
                    method = %req.method(),
                    path = %req.uri().path(),
                )
            })
        )
        // Outermost on purpose. axum applies layers bottom-up, so CORS has to
        // be last — otherwise an unauthenticated OPTIONS preflight gets a 401
        // with no CORS headers and the browser reports an opaque failure.
        .layer(auth::cors(&state.cfg))
        .with_state(state)
}

/// Serves a payload the sampler already serialized, skipping serde entirely
/// on the request path.
pub struct CachedJson(pub Arc<str>);

impl IntoResponse for CachedJson {
    fn into_response(self) -> Response {
        (
            [(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
            self.0.to_string(),
        ).into_response()
    }
}
