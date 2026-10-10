use serde::{ Deserialize, Serialize };
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum CheckKind {
    /// A GET that doesn't follow redirects. Up when the status is below 400,
    /// or on any response when `any_status` is set.
    Http,
    /// A TCP connect to `host:port`. A refusal is down.
    Tcp,
}

impl CheckKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Http => "http",
            Self::Tcp => "tcp",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "http" => Some(Self::Http),
            "tcp" => Some(Self::Tcp),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum CheckSource {
    /// Made for a service from its `cosmos.service.url` label.
    Service,
    /// Added in the UI.
    Custom,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Up,
    /// Failed enough times in a row to open a problem.
    Down,
    /// Failing, but not yet enough times in a row to call it down.
    Failing,
    /// No result yet.
    Pending,
    /// Turned off, or a service with no running container.
    Paused,
}

/// What is checked, and how often.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeCheck {
    /// `svc:<service>` for a service's check, a number for a custom one.
    pub id: String,
    pub source: CheckSource,
    pub name: String,
    pub kind: CheckKind,
    /// A URL for `http`, `host:port` for `tcp`.
    pub target: String,
    pub interval_secs: u32,
    pub enabled: bool,
    pub any_status: bool,
    /// The `cosmos.service` it belongs to.
    pub service: Option<String>,
    /// A peer the target is reached through (Pluto's checks of the public
    /// sites go through Jupiter). Its failures are held back from
    /// notifications while that peer is unreachable. Absent before 0.11.
    #[serde(default)]
    pub via_peer: Option<String>,
}

/// One result, for the heartbeat bar.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeBeat {
    /// Unix seconds.
    #[ts(type = "number")]
    pub at: i64,
    pub ok: bool,
    /// Until the response headers, or the connection for `tcp`.
    pub latency_ms: Option<u32>,
    /// "HTTP 502", "timed out": why a failed check failed.
    pub detail: Option<String>,
}

/// Fractions of checks that passed, 0 to 1. `None` with no results in the
/// window.
#[derive(Serialize, Deserialize, TS, Debug, Clone, Default, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeStats {
    pub day: Option<f64>,
    pub month: Option<f64>,
    pub quarter: Option<f64>,
    /// Mean over the last 24 hours.
    pub latency_ms: Option<u32>,
}

/// The TLS certificate an HTTPS check was served.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct CertInfo {
    #[ts(type = "number")]
    pub not_before: i64,
    #[ts(type = "number")]
    pub not_after: i64,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeEntry {
    pub check: UptimeCheck,
    pub state: CheckState,
    /// Unix seconds the state last changed, while this agent has run.
    #[ts(type = "number | null")]
    pub since: Option<i64>,
    /// The newest results, oldest first; at most 90.
    pub recent: Vec<UptimeBeat>,
    pub stats: UptimeStats,
    pub cert: Option<CertInfo>,
}

/// `GET /v1/uptime`.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeResponse {
    pub checks: Vec<UptimeEntry>,
    #[ts(type = "number")]
    pub sampled_at: i64,
}

/// Adding or editing a custom check.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeCheckInput {
    pub name: String,
    pub kind: CheckKind,
    pub target: String,
    /// Defaults to `[uptime] interval_secs`.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub interval_secs: Option<u32>,
    pub enabled: bool,
    #[serde(default)]
    pub any_status: bool,
    /// One of the agent's `[[peers]]`, or none.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub via_peer: Option<String>,
}

/// Settings for a service's automatic check.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UptimeServiceInput {
    pub enabled: bool,
    /// Appended to the service's URL; `/` when empty.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub path: Option<String>,
    #[serde(default)]
    pub any_status: bool,
}
