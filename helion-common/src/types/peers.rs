use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// What two agents say to each other, both ways: the dialling agent sends
/// it in the heartbeat and the other answers with its own, so one exchange
/// tells each that the other is alive.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct PeerHello {
    /// The sender's node name, which the receiver knows it by.
    pub node: String,
    pub version: String,
    /// Unix seconds.
    #[ts(type = "number")]
    pub sent_at: i64,
    /// The sender is shutting down on purpose (a deploy, a reboot), so the
    /// receiver allows it longer before calling it unreachable.
    #[serde(default)]
    pub stopping: bool,
}

/// Which side opens the connection. Only one has to be able to reach the
/// other: Pluto dials Jupiter, because Jupiter can't reach Pluto.
#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum PeerDirection {
    /// This agent sends heartbeats to the peer.
    Dial,
    /// The peer sends heartbeats to this agent.
    Listen,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum PeerState {
    /// Not heard from since this agent started, and not yet overdue.
    Unknown,
    Up,
    /// A heartbeat is overdue, but not for long enough to call it down.
    Late,
    /// Unreachable: a `peer:<name>:unreachable` problem is open.
    Down,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct PeerStatus {
    pub name: String,
    pub direction: PeerDirection,
    pub state: PeerState,
    /// Unix seconds of the last heartbeat either way.
    #[ts(type = "number | null")]
    pub last_seen: Option<i64>,
    /// The peer's agent version, from its last heartbeat.
    pub version: Option<String>,
    /// Round trip of the last heartbeat this agent sent.
    pub latency_ms: Option<u32>,
    /// Why the last heartbeat this agent sent failed.
    pub last_error: Option<String>,
    /// Its last heartbeat said it was shutting down.
    pub stopping: bool,
}

/// `GET /v1/peers`.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct PeersResponse {
    pub peers: Vec<PeerStatus>,
}
