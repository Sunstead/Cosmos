use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// The tailnet as this node's `tailscaled` sees it: itself plus every peer
/// in its network map. ACLs can hide devices, so another node may see a
/// different set; the app merges by `id`.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct TailnetStatus {
    /// e.g. `example.github`. `None` while logged out.
    pub tailnet: Option<String>,
    /// `Running` when healthy; anything else means the node is logged out,
    /// starting or stopped, and `devices` may be empty or stale.
    pub backend_state: String,
    /// This node first, then peers by name.
    pub devices: Vec<TailnetDevice>,
    #[ts(type = "number")]
    pub sampled_at: i64,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct TailnetDevice {
    /// Stable node ID. Survives renames and re-keying.
    pub id: String,
    /// The machine name, as the admin console and `tailscale status` show
    /// it: the first label of `dns_name`. Not the OS hostname, which is
    /// `localhost` on every iPhone and iPad. Agents 0.8.0 and older sent the
    /// hostname here.
    pub name: String,
    /// MagicDNS name, without the trailing dot.
    pub dns_name: String,
    /// `linux`, `windows`, `macOS`, `iOS`, `android`...
    pub os: String,
    /// Login name of the owner, e.g. `user@example.com`.
    pub user: Option<String>,
    pub ips: Vec<String>,
    pub tags: Vec<String>,
    pub is_self: bool,
    /// Connected to the coordination server. Lags a few minutes behind a
    /// machine going to sleep, but is quick to flip back on wake.
    pub online: bool,
    /// Traffic with this node recently.
    pub active: bool,
    /// RFC3339. Only reported for offline devices.
    pub last_seen: Option<String>,
    /// RFC3339. `None` when key expiry is disabled for the device.
    pub key_expiry: Option<String>,
    pub key_expired: bool,
    pub connection: TailnetConnection,
    pub exit_node: bool,
    #[ts(type = "number")]
    pub rx_bytes: u64,
    #[ts(type = "number")]
    pub tx_bytes: u64,
}

/// How traffic to a peer travels right now.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "../../app/src/generated/")]
pub enum TailnetConnection {
    /// Peer-to-peer, at `endpoint` (ip:port).
    Direct {
        endpoint: String,
    },
    /// Through a DERP relay in `region`, e.g. `nyc`. Works, but slower.
    Relay {
        region: String,
    },
    /// No recent traffic, so no path has been chosen. Also this node itself.
    Idle,
}
