use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// Served unauthenticated from `/v1/info` so the add-node flow can distinguish
/// "nothing is listening here" from "an agent is here and wants a token"
/// before it has a token to present.
///
/// A 404 on this route means a pre-0.2 agent: assume `api_version: 0` and the
/// original four read-only endpoints.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct AgentInfo {
    pub agent_version: String,
    pub api_version: u32,
    pub auth_required: bool,
    /// `None` unless the request was authenticated — the node's name is not
    /// something an unauthenticated caller should be able to harvest.
    pub node_name: Option<String>,
    pub capabilities: Capabilities,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct Capabilities {
    pub host_metrics: bool,
    pub containers: bool,
    pub container_actions: bool,
    pub container_logs: bool,
    pub websocket_logs: bool,
    pub volumes: bool,
    pub metrics_history: bool,
    pub backups: bool,
}

impl Capabilities {
    /// What a pre-0.2 agent (no `/v1/info` route) is assumed to support.
    pub fn legacy() -> Self {
        Self {
            host_metrics: true,
            containers: true,
            container_actions: false,
            container_logs: false,
            websocket_logs: false,
            volumes: true,
            metrics_history: false,
            backups: false,
        }
    }
}
