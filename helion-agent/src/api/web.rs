//! Serves the web UI build from the agent's own origin, so the browser needs no
//! CORS and one address works for both the site and the desktop app.

use axum::{
    body::Body,
    extract::Request,
    http::{ header, HeaderValue, Method, StatusCode },
    response::{ IntoResponse, Response },
    routing::get,
    Json,
    Router,
};
use std::path::Path;
use tower_http::{ compression::CompressionLayer, services::ServeDir };

/// `None` when `dir` holds no `index.html`, so a bad path degrades to API-only.
pub fn router<S: Clone + Send + Sync + 'static>(dir: &Path, peers: Vec<String>) -> Option<Router<S>> {
    if !dir.join("index.html").is_file() {
        tracing::warn!(dir = %dir.display(), "web.dir has no index.html; not serving the web UI");
        return None;
    }
    tracing::info!(dir = %dir.display(), "serving web UI");

    let files = ServeDir::new(dir);
    Some(
        Router::new()
            .route("/config.json", get(move || config_json(peers.clone())))
            .fallback(move |req: Request| serve(files.clone(), req))
            .layer(CompressionLayer::new().gzip(true))
    )
}

/// Seeds the UI with this agent, then its peers' web UIs. This one is
/// relative, so it resolves against whatever origin the page was loaded
/// from, proxied or not.
async fn config_json(peers: Vec<String>) -> impl IntoResponse {
    let nodes: Vec<serde_json::Value> = std::iter
        ::once("/".to_string())
        .chain(peers)
        .map(|url| serde_json::json!({ "url": url }))
        .collect();
    ([(header::CACHE_CONTROL, "no-cache")], Json(nodes))
}

async fn serve(mut files: ServeDir, req: Request) -> Response {
    let path = req.uri().path().to_owned();
    // Unknown API paths must stay 404s, not turn into the app shell.
    if path == "/v1" || path.starts_with("/v1/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }

    // Hashed build output never changes; everything else must revalidate so a
    // deploy is picked up on the next load.
    let asset = path.starts_with("/assets/");
    let mut res = match files.try_call(req).await {
        Ok(res) => res.map(Body::new),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };

    // Client-side routes (`/nodes/abc`) get the app shell. Missing assets stay
    // 404 so a stale chunk isn't cached as HTML.
    if res.status() == StatusCode::NOT_FOUND && !asset {
        let index = Request::builder().uri("/index.html").body(Body::empty()).unwrap_or_default();
        res = match files.try_call(index).await {
            Ok(res) => res.map(Body::new),
            Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }

    let cache = if asset && res.status().is_success() {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let headers = res.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    fn site() -> (tempfile::TempDir, Router) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "<!doctype html>app").unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/app-abc.js"), "js").unwrap();
        let router = router(dir.path(), vec!["https://pluto.example.net:7700".into()]).unwrap();
        (dir, router)
    }

    async fn get(router: &Router, path: &str) -> Response {
        router.clone().oneshot(Request::get(path).body(Body::empty()).unwrap()).await.unwrap()
    }

    async fn text(res: Response) -> String {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn serves_index_and_client_routes() {
        let (_dir, r) = site();
        for path in ["/", "/nodes/abc"] {
            let res = get(&r, path).await;
            assert_eq!(res.status(), StatusCode::OK, "{path}");
            assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");
            assert!(text(res).await.contains("app"));
        }
    }

    #[tokio::test]
    async fn assets_are_immutable_and_missing_ones_404() {
        let (_dir, r) = site();
        let res = get(&r, "/assets/app-abc.js").await;
        assert_eq!(res.status(), StatusCode::OK);
        assert!(res.headers()[header::CACHE_CONTROL].to_str().unwrap().contains("immutable"));
        assert_eq!(get(&r, "/assets/gone.js").await.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn unknown_api_paths_are_not_the_app_shell() {
        let (_dir, r) = site();
        assert_eq!(get(&r, "/v1/nope").await.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn config_points_at_this_origin_then_the_peers() {
        let (_dir, r) = site();
        assert_eq!(
            text(get(&r, "/config.json").await).await,
            r#"[{"url":"/"},{"url":"https://pluto.example.net:7700"}]"#
        );
    }

    #[test]
    fn missing_index_disables_the_ui() {
        let dir = tempfile::tempdir().unwrap();
        assert!(router::<()>(dir.path(), Vec::new()).is_none());
    }
}
