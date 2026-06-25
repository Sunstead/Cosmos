mod docker;
mod metrics;

use axum::{ extract::State, routing::get, Json, Router };
use cosmos_common::types::{ ContainersResponse, HostInfo };
use std::{ net::SocketAddr, sync::Arc };
use sysinfo::System;
use tokio::sync::Mutex;
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
        .route("/v1/containers", get(containers_handler))
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

async fn containers_handler() -> Json<ContainersResponse> {
    Json(docker::get_containers().await)
}
