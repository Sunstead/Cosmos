use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// A machine this node can wake. Stored on the agent and edited from the
/// UI; it belongs to the node on its LAN, since magic packets don't route.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolTarget {
    pub id: String,
    pub name: String,
    /// Normalised to lowercase `aa:bb:cc:dd:ee:ff`.
    pub mac: String,
    /// IPv4 broadcast to send to. `None` sends to 255.255.255.255.
    pub broadcast: Option<String>,
    /// UDP port for the magic packet; 9 by convention.
    pub port: u16,
    /// Stable tailnet device ID. When set, Tailscale's online state is how
    /// the agent tells the machine woke.
    pub tailnet_device: Option<String>,
    /// A second signal, for machines not on the tailnet.
    pub probe: Option<WolProbe>,
}

/// Anything that answers a TCP connect, even with a refusal, is awake.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolProbe {
    pub host: String,
    pub port: u16,
}

/// What the UI sends to create or replace a target.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolTargetInput {
    pub name: String,
    pub mac: String,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub broadcast: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub port: Option<u16>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub tailnet_device: Option<String>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub probe: Option<WolProbe>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "../../app/src/generated/")]
pub enum WolState {
    Awake,
    Asleep,
    /// A packet went out and we're watching for it to come up.
    Waking,
    /// The last wake timed out and it's still down.
    DidNotWake,
    /// No tailnet device or probe to ask.
    Unknown,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolWake {
    /// Unix seconds.
    #[ts(type = "number")]
    pub at: i64,
    /// Who sent it.
    pub by: String,
    /// `None` while still waiting.
    pub woke: Option<bool>,
    /// From packet to online, when it woke.
    pub took_secs: Option<u32>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolEntry {
    pub target: WolTarget,
    pub state: WolState,
    /// RFC3339, from the tailnet, when the machine is offline.
    pub last_seen: Option<String>,
    pub last_wake: Option<WolWake>,
}

/// A local IPv4 network a packet could be broadcast to.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolNetwork {
    pub interface: String,
    /// e.g. `192.168.1.10/24`.
    pub cidr: String,
    pub broadcast: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolResponse {
    pub targets: Vec<WolEntry>,
    pub networks: Vec<WolNetwork>,
    #[ts(type = "number")]
    pub sampled_at: i64,
}

/// A machine the host has recently talked to, from its ARP table, so a MAC
/// can be picked rather than typed.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolNeighbor {
    pub ip: String,
    pub mac: String,
    pub interface: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct WolNeighborsResponse {
    pub neighbors: Vec<WolNeighbor>,
}
