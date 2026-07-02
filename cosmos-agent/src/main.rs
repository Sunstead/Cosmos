mod docker;
mod metrics;
mod volumes;

use axum::{ extract::State, response::sse::{ Event, KeepAlive, Sse }, routing::get, Json, Router };
use cosmos_common::types::{ ContainersResponse, HostInfo, VolumesResponse };
use futures_util::{ Stream, StreamExt };
use std::{ convert::Infallible, net::SocketAddr, sync::Arc, time::Duration };
use sysinfo::System;
use tokio::sync::Mutex;
use tokio_stream::wrappers::IntervalStream;
use tower_http::cors::CorsLayer;

pub struct NetSnapshot {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub time: std::time::Instant,
}

pub struct DiskSnapshot {
    pub read_bytes: std::collections::HashMap<String, u64>,
    pub write_bytes: std::collections::HashMap<String, u64>,
    pub time: std::time::Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub node_name: String,
    pub last_net: Arc<Mutex<Option<NetSnapshot>>>,
    pub last_disk: Arc<Mutex<Option<DiskSnapshot>>>,
}

#[tokio::main]
async fn main() {
    let node_name = std::env
        ::var("COSMOS_NODE_NAME")
        .unwrap_or_else(|_| System::host_name().unwrap_or_else(|| "unknown".to_string()));

    println!("cosmos-agent starting as node: {node_name}");

    let state = AppState {
        node_name,
        last_net: Arc::new(Mutex::new(None)),
        last_disk: Arc::new(Mutex::new(None)),
    };

    let app = Router::new()
        .route("/v1/host", get(host_handler))
        .route("/v1/host/stream", get(host_stream_handler))
        .route("/v1/containers", get(containers_handler))
        .route("/v1/volumes", get(volumes_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 7700));
    println!("cosmos-agent listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn host_handler(State(state): State<AppState>) -> Json<HostInfo> {
    Json(metrics::get_host_info(state).await)
}

async fn host_stream_handler(State(state): State<AppState>) -> Sse<
    impl Stream<Item = Result<Event, Infallible>>
> {
    let stream = IntervalStream::new(tokio::time::interval(Duration::from_secs(1))).then(move |_| {
        let state = state.clone();
        async move {
            let info = metrics::get_host_info(state).await;
            let data = serde_json::to_string(&info).unwrap_or_default();
            Ok::<Event, Infallible>(Event::default().data(data))
        }
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn containers_handler() -> Json<ContainersResponse> {
    Json(docker::get_containers().await)
}

async fn volumes_handler() -> Json<VolumesResponse> {
    Json(volumes::get_volumes().await)
}