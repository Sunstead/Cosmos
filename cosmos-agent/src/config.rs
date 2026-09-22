//! Agent configuration: a TOML file with a `COSMOS_AGENT_*` environment
//! overlay on top. Everything has a working default except the auth token,
//! which the agent refuses to start without.

use serde::Deserialize;
use std::{ net::SocketAddr, path::PathBuf };

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("reading {path}: {source}")] Read {
        path: String,
        #[source] source: std::io::Error,
    },
    #[error("parsing {path}: {source}")] Parse {
        path: String,
        #[source] source: toml::de::Error,
    },
    #[error("{0}")] Invalid(String),
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Defaults to the system hostname.
    pub node_name: Option<String>,
    /// Off by default: a node is read-only until you say otherwise. Gates
    /// every mutating route (container and volume actions, Wake-on-LAN), and
    /// even then only for admins.
    pub allow_actions: bool,
    pub server: ServerConfig,
    pub auth: AuthConfig,
    pub cors: CorsConfig,
    pub host: HostConfig,
    pub docker: DockerConfig,
    pub history: HistoryConfig,
    pub backups: BackupsConfig,
    pub web: WebConfig,
    pub state: StateConfig,
    pub tailscale: TailscaleConfig,
    pub wol: WolConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WolConfig {
    /// Targets are added in the UI and kept in `[state] path`. Waking and
    /// editing also need `allow_actions` and an admin.
    pub enabled: bool,
    pub interval_ms: u64,
    /// How long after a packet to keep watching before calling it failed.
    pub wake_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TailscaleConfig {
    pub enabled: bool,
    /// The host's `tailscaled` socket, bind-mounted in. Read-only access is
    /// all `tailscaled` gives a non-root caller, and all the agent needs.
    pub socket: PathBuf,
    pub interval_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StateConfig {
    /// Settings edited from the UI. Separate from the metrics history,
    /// whose writer thread owns that database.
    pub path: PathBuf,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WebConfig {
    /// A built web UI (`app/dist`) to serve from the agent's own origin.
    /// The Docker image sets this; unset means API only.
    pub dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub shutdown_grace_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AuthConfig {
    pub token: Option<String>,
    /// Preferred over `token` — keeps the secret out of the config file.
    pub token_file: Option<PathBuf>,
    /// Browser `EventSource` and `WebSocket` cannot set request headers, so
    /// the streaming routes need `?token=`. Turning this off breaks live
    /// metrics in the web build.
    pub allow_query_token: bool,
    /// Must be set explicitly to run without a token. Guards against
    /// accidentally exposing container actions to the whole LAN.
    pub allow_anonymous: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CorsConfig {
    pub extra_origins: Vec<String>,
    /// Some WKWebView configurations send `Origin: null` for custom-scheme
    /// pages. Off by default because it's a broad allowance.
    pub allow_null_origin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HostConfig {
    pub interval_ms: u64,
    /// Glob patterns. Ignored when `net_include` is non-empty.
    pub net_exclude: Vec<String>,
    /// Non-empty turns this into an allowlist.
    pub net_include: Vec<String>,
    /// Which filesystems to report, and what to call them. Empty means
    /// "report everything with a non-zero size", which is right on a host and
    /// wrong in a container (you get overlayfs and every bind mount).
    pub disks: Vec<DiskConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiskConfig {
    /// Mount point as the agent sees it, e.g. `/host/rootfs`.
    pub path: String,
    /// What to show the user, e.g. `/`. Defaults to `path`.
    pub label: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DockerConfig {
    pub socket: String,
    pub interval_ms: u64,
    /// Cap on simultaneous `stats` calls against the Docker socket.
    pub stats_concurrency: usize,
    /// Deprecated: use the top-level `allow_actions`, which now also covers
    /// Wake-on-LAN. Still read so existing configs keep working.
    pub allow_actions: Option<bool>,
    pub allow_logs: bool,
    /// Subscribe to the Docker event stream so the container list refreshes
    /// immediately on start/stop rather than at the next poll.
    pub watch_events: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HistoryConfig {
    pub enabled: bool,
    pub path: PathBuf,
    pub flush_interval_secs: u64,
    pub retain_1s_secs: i64,
    pub retain_1m_secs: i64,
    pub retain_5m_secs: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BackupsConfig {
    pub enabled: bool,
    /// Written by the backup job on the host. The agent only reads it.
    pub status_file: PathBuf,
    /// systemd timer stamp file. Its mtime is an independent signal that the
    /// timer fired, even if the job died before writing a status.
    pub timer_stamp: Option<PathBuf>,
    /// Used to decide whether the status has gone stale.
    pub expected_interval_secs: u64,
    /// Display name. Never the real repository path.
    pub repo_label: String,
}

// --- defaults --------------------------------------------------------------

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from(([0, 0, 0, 0], 7700)),
            shutdown_grace_secs: 10,
        }
    }
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            token: None,
            token_file: None,
            allow_query_token: true,
            allow_anonymous: false,
        }
    }
}

impl Default for HostConfig {
    fn default() -> Self {
        Self {
            interval_ms: 1000,
            // Under `network_mode: host` the agent sees every bridge and veth
            // the host has. Summing those into "node throughput" double-counts
            // container traffic.
            // `lo*` rather than `lo`: Linux names loopback `lo`, macOS `lo0`.
            // Loopback is the single biggest distorter of "node throughput".
            net_exclude: ["lo*", "docker*", "br-*", "veth*", "virbr*", "cni*", "flannel*"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            net_include: Vec::new(),
            disks: Vec::new(),
        }
    }
}

impl Default for DockerConfig {
    fn default() -> Self {
        Self {
            socket: "/var/run/docker.sock".to_string(),
            interval_ms: 2000,
            stats_concurrency: 8,
            allow_actions: None,
            allow_logs: true,
            watch_events: true,
        }
    }
}

impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            path: PathBuf::from("/var/lib/cosmos-agent/metrics.db"),
            flush_interval_secs: 10,
            retain_1s_secs: 3_600, // 1 hour
            retain_1m_secs: 604_800, // 7 days
            retain_5m_secs: 7_776_000, // 90 days
        }
    }
}

impl Default for TailscaleConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            socket: PathBuf::from("/var/run/tailscale/tailscaled.sock"),
            interval_ms: 10_000,
        }
    }
}

impl Default for WolConfig {
    fn default() -> Self {
        Self { enabled: false, interval_ms: 10_000, wake_timeout_secs: 180 }
    }
}

impl Default for StateConfig {
    fn default() -> Self {
        Self { path: PathBuf::from("/var/lib/cosmos-agent/state.db") }
    }
}

impl Default for BackupsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            status_file: PathBuf::from("/host/backups/restic-status.json"),
            timer_stamp: None,
            expected_interval_secs: 86_400,
            repo_label: "restic".to_string(),
        }
    }
}

// --- loading ---------------------------------------------------------------

impl Config {
    /// Reads the TOML file named by `COSMOS_AGENT_CONFIG` (if set and present),
    /// then applies the environment overlay, then validates.
    pub fn load() -> Result<Self, ConfigError> {
        let mut cfg = match std::env::var("COSMOS_AGENT_CONFIG").ok() {
            Some(path) => Self::from_file(&path)?,
            // No config file is a perfectly good way to run the agent: the
            // defaults plus COSMOS_AGENT_TOKEN are enough.
            None => Self::default(),
        };
        cfg.migrate_deprecated()?;
        cfg.apply_env()?;
        cfg.validate()?;
        Ok(cfg)
    }

    /// Folds `docker.allow_actions` into the top-level switch. Setting both
    /// to different values is an error rather than a silent precedence rule.
    fn migrate_deprecated(&mut self) -> Result<(), ConfigError> {
        if let Some(v) = self.docker.allow_actions.take() {
            if self.allow_actions && !v {
                return Err(
                    ConfigError::Invalid(
                        "allow_actions and docker.allow_actions disagree; remove docker.allow_actions".into()
                    )
                );
            }
            tracing::warn!(
                "docker.allow_actions is deprecated; move it to the top-level allow_actions"
            );
            self.allow_actions |= v;
        }
        Ok(())
    }

    fn from_file(path: &str) -> Result<Self, ConfigError> {
        let text = std::fs
            ::read_to_string(path)
            .map_err(|source| ConfigError::Read { path: path.to_string(), source })?;
        toml
            ::from_str(&text)
            .map_err(|source| ConfigError::Parse { path: path.to_string(), source })
    }

    fn apply_env(&mut self) -> Result<(), ConfigError> {
        if let Ok(v) = std::env::var("COSMOS_NODE_NAME") {
            self.node_name = Some(v);
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_BIND") {
            self.server.bind = v
                .parse()
                .map_err(|_| ConfigError::Invalid(format!("COSMOS_AGENT_BIND is not an address: {v}")))?;
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_TOKEN") {
            self.auth.token = Some(v);
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_TOKEN_FILE") {
            self.auth.token_file = Some(PathBuf::from(v));
        }
        if let Some(v) = env_bool("COSMOS_AGENT_ALLOW_ACTIONS")? {
            self.allow_actions = v;
        }
        if let Some(v) = env_bool("COSMOS_AGENT_ALLOW_ANONYMOUS")? {
            self.auth.allow_anonymous = v;
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_DOCKER_SOCKET") {
            self.docker.socket = v;
        }
        if let Some(v) = env_bool("COSMOS_AGENT_HISTORY")? {
            self.history.enabled = v;
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_HISTORY_PATH") {
            self.history.path = PathBuf::from(v);
        }
        if let Ok(v) = std::env::var("COSMOS_AGENT_WEB_DIR") {
            self.web.dir = (!v.is_empty()).then(|| PathBuf::from(v));
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), ConfigError> {
        if self.host.interval_ms < 200 {
            return Err(
                ConfigError::Invalid(
                    "host.interval_ms below 200 samples faster than the CPU counters update".into()
                )
            );
        }
        if self.docker.interval_ms < 500 {
            return Err(ConfigError::Invalid("docker.interval_ms must be at least 500".into()));
        }
        if self.tailscale.interval_ms < 1000 {
            return Err(ConfigError::Invalid("tailscale.interval_ms must be at least 1000".into()));
        }
        if self.wol.interval_ms < 1000 {
            return Err(ConfigError::Invalid("wol.interval_ms must be at least 1000".into()));
        }
        if self.wol.wake_timeout_secs < 10 {
            return Err(ConfigError::Invalid("wol.wake_timeout_secs must be at least 10".into()));
        }
        if self.docker.stats_concurrency == 0 {
            return Err(ConfigError::Invalid("docker.stats_concurrency must be at least 1".into()));
        }
        Ok(())
    }

    /// Resolves the token from `token_file` or `token`, in that order.
    ///
    /// Returns `Ok(None)` only when anonymous access was explicitly allowed;
    /// otherwise a missing token is a startup failure, because an agent that
    /// can stop containers must not be open by default.
    pub fn resolve_token(&self) -> Result<Option<String>, ConfigError> {
        if let Some(path) = &self.auth.token_file {
            let raw = std::fs
                ::read_to_string(path)
                .map_err(|source| ConfigError::Read {
                    path: path.display().to_string(),
                    source,
                })?;
            let token = raw.trim().to_string();
            if token.is_empty() {
                return Err(
                    ConfigError::Invalid(format!("token file {} is empty", path.display()))
                );
            }
            return Ok(Some(token));
        }
        if let Some(token) = self.auth.token.as_ref().map(|t| t.trim()).filter(|t| !t.is_empty()) {
            return Ok(Some(token.to_string()));
        }
        if self.auth.allow_anonymous {
            return Ok(None);
        }
        Err(
            ConfigError::Invalid(
                "no auth token configured. Set COSMOS_AGENT_TOKEN, or auth.token_file in the \
                 config, or set auth.allow_anonymous = true if this agent really should be open \
                 to anyone who can reach it".into()
            )
        )
    }
}

fn env_bool(key: &str) -> Result<Option<bool>, ConfigError> {
    match std::env::var(key) {
        Err(_) => Ok(None),
        Ok(v) =>
            match v.trim().to_ascii_lowercase().as_str() {
                "1" | "true" | "yes" | "on" => Ok(Some(true)),
                "0" | "false" | "no" | "off" => Ok(Some(false)),
                other => Err(ConfigError::Invalid(format!("{key} is not a boolean: {other}"))),
            }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        Config::default().validate().expect("shipped defaults must validate");
    }

    #[test]
    fn missing_token_is_a_startup_error_unless_anonymous_is_explicit() {
        let mut cfg = Config::default();
        assert!(cfg.resolve_token().is_err(), "a tokenless agent must refuse to start");

        cfg.auth.allow_anonymous = true;
        assert_eq!(cfg.resolve_token().unwrap(), None);
    }

    #[test]
    fn blank_token_is_treated_as_absent() {
        let mut cfg = Config::default();
        cfg.auth.token = Some("   ".to_string());
        assert!(cfg.resolve_token().is_err());
    }

    #[test]
    fn rejects_sampling_faster_than_the_cpu_counters_update() {
        let mut cfg = Config::default();
        cfg.host.interval_ms = 50;
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn parses_a_config_file() {
        let cfg: Config = toml
            ::from_str(
                r#"
                node_name = "jupiter"
                allow_actions = true
                [server]
                bind = "127.0.0.1:9000"
                [[host.disks]]
                path = "/host/rootfs"
                label = "/"
            "#
            )
            .expect("valid config");

        assert_eq!(cfg.node_name.as_deref(), Some("jupiter"));
        assert_eq!(cfg.server.bind.port(), 9000);
        assert!(cfg.allow_actions);
        assert_eq!(cfg.host.disks.len(), 1);
        assert_eq!(cfg.host.disks[0].label.as_deref(), Some("/"));
        // Untouched sections keep their defaults.
        assert_eq!(cfg.host.interval_ms, 1000);
    }

    #[test]
    fn deprecated_docker_allow_actions_still_enables_actions() {
        let mut cfg: Config = toml::from_str("[docker]\nallow_actions = true").unwrap();
        cfg.migrate_deprecated().unwrap();
        assert!(cfg.allow_actions);
        assert_eq!(cfg.docker.allow_actions, None);
    }

    #[test]
    fn conflicting_allow_actions_is_an_error() {
        let mut cfg: Config = toml
            ::from_str("allow_actions = true\n[docker]\nallow_actions = false")
            .unwrap();
        assert!(cfg.migrate_deprecated().is_err());
    }
}
