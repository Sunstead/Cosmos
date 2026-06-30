use serde::{ Deserialize, Serialize };
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct DiskInfo {
    pub mount: String,
    pub used_gb: f64,
    pub total_gb: f64,
    pub read_mbps: f64,
    pub write_mbps: f64,
    pub kind: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub enum PortType {
    Tcp,
    Udp,
    Sctp,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct PortInfo {
    pub ip: Option<String>,
    pub private_port: u16,
    pub public_port: Option<u16>,
    pub port_type: Option<PortType>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct HostInfo {
    pub name: String,
    pub hostname: String,
    pub os: String,
    pub cpu_model: String,
    pub cpu_physical_cores: usize,
    pub cpu_logical_cores: usize,
    pub cpu_freq_mhz: u64,
    pub cpu_pct: f32,
    pub mem_used_gb: f64,
    pub mem_total_gb: f64,
    pub disk: Vec<DiskInfo>,
    pub net_rx_mbps: f64,
    pub net_tx_mbps: f64,
    pub uptime_secs: u64,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: Vec<PortInfo>,
    pub started_at: Option<String>,
    pub compose_project: Option<String>,
    pub cosmos_service: Option<String>,
    pub cosmos_service_description: Option<String>,
    pub cosmos_service_url: Option<String>,
    pub cpu_pct: f64,
    pub mem_mb: f64,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct ContainersResponse {
    pub containers: Vec<ContainerInfo>,
}
