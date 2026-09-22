//! Tailnet devices, read from the local `tailscaled`.
//!
//! The LocalAPI is HTTP over a unix socket. `tailscaled` authorises by the
//! connecting uid (`SO_PEERCRED`): anyone gets read-only access, and only root
//! or the configured operator can change anything. The agent runs as 65532,
//! so mounting the socket grants it status and nothing else. No API key.
//!
//! Requests go out as HTTP/1.0 so the response can't be chunked and ends at
//! EOF. That keeps this a few lines of tokio I/O instead of an HTTP client.

use crate::config::TailscaleConfig;
use cosmos_common::types::{ TailnetConnection, TailnetDevice, TailnetStatus };
use serde::Deserialize;
use std::{ collections::HashMap, path::Path, sync::Arc, time::Duration };
use tokio::sync::watch;

/// Largest status body we'll buffer. A tailnet of a few hundred devices is
/// well under 1 MB.
const MAX_BODY: usize = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(5);

/// The latest poll. Keeps the parsed form as well as the JSON: Wake-on-LAN
/// reads `online` from it to tell when a machine has woken.
pub struct TailnetSnapshot {
    pub result: Result<TailnetData, String>,
}

pub struct TailnetData {
    pub status: Arc<TailnetStatus>,
    pub json: Arc<str>,
}

impl TailnetSnapshot {
    fn ok(status: TailnetStatus) -> Self {
        let json: Arc<str> = serde_json
            ::to_string(&status)
            .unwrap_or_else(|_| "{}".to_string())
            .into();
        Self { result: Ok(TailnetData { status: Arc::new(status), json }) }
    }

    fn err(message: impl Into<String>) -> Self {
        Self { result: Err(message.into()) }
    }
}

pub fn spawn(cfg: &TailscaleConfig) -> watch::Receiver<Arc<TailnetSnapshot>> {
    let (tx, rx) = watch::channel(Arc::new(TailnetSnapshot::err("not sampled yet")));
    let socket = cfg.socket.clone();
    let period = Duration::from_millis(cfg.interval_ms);

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut was_ok: Option<bool> = None;

        loop {
            ticker.tick().await;
            let snapshot = match poll(&socket).await {
                Ok(status) => TailnetSnapshot::ok(status),
                Err(e) => TailnetSnapshot::err(e),
            };

            // Log transitions, not every failed tick.
            let ok = snapshot.result.is_ok();
            if was_ok != Some(ok) {
                match &snapshot.result {
                    Ok(data) =>
                        tracing::info!(
                            devices = data.status.devices.len(),
                            state = %data.status.backend_state,
                            "tailnet readable"
                        ),
                    Err(e) =>
                        tracing::warn!(
                            socket = %socket.display(),
                            error = %e,
                            "cannot read tailnet status"
                        ),
                }
                was_ok = Some(ok);
            }

            if tx.send(Arc::new(snapshot)).is_err() {
                return;
            }
        }
    });

    rx
}

async fn poll(socket: &Path) -> Result<TailnetStatus, String> {
    let body = tokio::time
        ::timeout(TIMEOUT, get(socket, "/localapi/v0/status")).await
        .map_err(|_| "tailscaled did not answer within 5s".to_string())??;
    let raw: RawStatus = serde_json
        ::from_slice(&body)
        .map_err(|e| format!("unexpected status JSON: {e}"))?;
    Ok(raw.into_status(now()))
}

#[cfg(unix)]
async fn get(socket: &Path, path: &str) -> Result<Vec<u8>, String> {
    use tokio::io::{ AsyncReadExt, AsyncWriteExt };

    let mut stream = tokio::net::UnixStream
        ::connect(socket).await
        .map_err(|e| format!("cannot connect to {}: {e}", socket.display()))?;

    // `local-tailscaled.sock` is the only Host the LocalAPI accepts without
    // a password, and it rejects any request carrying an Origin or Referer.
    let request = format!(
        "GET {path} HTTP/1.0\r\nHost: local-tailscaled.sock\r\nSec-Tailscale: localapi\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut response = Vec::new();
    (&mut stream)
        .take((MAX_BODY as u64) + 64 * 1024)
        .read_to_end(&mut response).await
        .map_err(|e| e.to_string())?;
    split_response(&response).map(<[u8]>::to_vec)
}

#[cfg(not(unix))]
async fn get(_socket: &Path, _path: &str) -> Result<Vec<u8>, String> {
    Err("the tailscaled socket is only supported on unix".into())
}

/// Checks the status line and returns the body.
fn split_response(response: &[u8]) -> Result<&[u8], String> {
    let split = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("truncated response from tailscaled")?;
    let (head, body) = (&response[..split], &response[split + 4..]);

    let status_line = head.split(|&b| b == b'\n').next().unwrap_or_default();
    let status_line = String::from_utf8_lossy(status_line);
    let code = status_line.split_whitespace().nth(1).unwrap_or_default();
    match code {
        "200" => Ok(body),
        "403" =>
            Err(
                "tailscaled refused the request (403); the agent's uid needs read access to the socket".into()
            ),
        _ => {
            let detail = String::from_utf8_lossy(&body[..body.len().min(200)]);
            Err(format!("tailscaled returned {}: {}", code, detail.trim()))
        }
    }
}

fn now() -> i64 {
    std::time::SystemTime
        ::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// --- the LocalAPI's shape (ipnstate.Status), only the fields we use ---------

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "PascalCase")]
struct RawStatus {
    backend_state: String,
    #[serde(rename = "Self")]
    self_: Option<RawPeer>,
    peer: Option<HashMap<String, RawPeer>>,
    user: Option<HashMap<String, RawUser>>,
    current_tailnet: Option<RawTailnet>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "PascalCase")]
struct RawTailnet {
    name: String,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "PascalCase")]
struct RawUser {
    login_name: String,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "PascalCase")]
struct RawPeer {
    #[serde(rename = "ID")]
    id: String,
    host_name: String,
    #[serde(rename = "DNSName")]
    dns_name: String,
    #[serde(rename = "OS")]
    os: String,
    #[serde(rename = "UserID")]
    user_id: i64,
    #[serde(rename = "TailscaleIPs")]
    tailscale_ips: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    cur_addr: String,
    relay: String,
    rx_bytes: i64,
    tx_bytes: i64,
    last_seen: Option<String>,
    online: bool,
    exit_node: bool,
    active: bool,
    expired: bool,
    key_expiry: Option<String>,
}

impl RawStatus {
    fn into_status(self, sampled_at: i64) -> TailnetStatus {
        let users = self.user.unwrap_or_default();
        let login = |id: i64| {
            users
                .get(&id.to_string())
                .map(|u| u.login_name.clone())
                .filter(|l| !l.is_empty())
        };

        let mut peers: Vec<TailnetDevice> = self.peer
            .unwrap_or_default()
            .into_values()
            .map(|p| {
                let user = login(p.user_id);
                p.into_device(false, user)
            })
            .collect();
        peers.sort_by_key(|d| d.name.to_lowercase());

        let mut devices = Vec::with_capacity(peers.len() + 1);
        if let Some(me) = self.self_ {
            let user = login(me.user_id);
            devices.push(me.into_device(true, user));
        }
        devices.extend(peers);

        TailnetStatus {
            tailnet: self.current_tailnet.map(|t| t.name).filter(|n| !n.is_empty()),
            backend_state: self.backend_state,
            devices,
            sampled_at,
        }
    }
}

impl RawPeer {
    fn into_device(self, is_self: bool, user: Option<String>) -> TailnetDevice {
        // Same reading as `tailscale status`: a path only exists while there
        // is traffic, and it's direct when there's a current address.
        let connection = if is_self || !self.active {
            TailnetConnection::Idle
        } else if !self.cur_addr.is_empty() {
            TailnetConnection::Direct { endpoint: self.cur_addr }
        } else if !self.relay.is_empty() {
            TailnetConnection::Relay { region: self.relay }
        } else {
            TailnetConnection::Idle
        };

        TailnetDevice {
            id: self.id,
            name: self.host_name,
            dns_name: self.dns_name.trim_end_matches('.').to_string(),
            os: self.os,
            user,
            ips: self.tailscale_ips.unwrap_or_default(),
            tags: self.tags.unwrap_or_default(),
            is_self,
            // Self reports its own control connection; treat it as online,
            // since we're the ones answering.
            online: is_self || self.online,
            active: self.active,
            last_seen: real_time(self.last_seen),
            key_expiry: real_time(self.key_expiry),
            key_expired: self.expired,
            connection,
            exit_node: self.exit_node,
            rx_bytes: self.rx_bytes.max(0) as u64,
            tx_bytes: self.tx_bytes.max(0) as u64,
        }
    }
}

/// Go marshals an unset `time.Time` as year 1.
fn real_time(t: Option<String>) -> Option<String> {
    t.filter(|t| !t.is_empty() && !t.starts_with("0001-01-01"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from `tailscale status --json`; same shape as the LocalAPI.
    const FIXTURE: &str =
        r#"{
      "Version": "1.90.0",
      "BackendState": "Running",
      "Self": {
        "ID": "nSELF", "HostName": "jupiter", "DNSName": "jupiter.tail1234.ts.net.",
        "OS": "linux", "UserID": 1, "TailscaleIPs": ["100.64.0.1", "fd7a::1"],
        "Tags": ["tag:server"], "CurAddr": "", "Relay": "nyc", "RxBytes": 0, "TxBytes": 0,
        "LastSeen": "0001-01-01T00:00:00Z", "Online": true, "Active": false
      },
      "CurrentTailnet": { "Name": "example.github", "MagicDNSSuffix": "tail1234.ts.net" },
      "Peer": {
        "nodekey:a": {
          "ID": "nDESK", "HostName": "Desktop", "DNSName": "desktop.tail1234.ts.net.",
          "OS": "windows", "UserID": 1, "TailscaleIPs": ["100.64.0.2"],
          "CurAddr": "192.168.1.20:41641", "Relay": "nyc", "RxBytes": 1200, "TxBytes": 3400,
          "LastSeen": "0001-01-01T00:00:00Z", "Online": true, "Active": true,
          "KeyExpiry": "2026-12-01T00:00:00Z"
        },
        "nodekey:b": {
          "ID": "nPHONE", "HostName": "pixel", "DNSName": "pixel.tail1234.ts.net.",
          "OS": "android", "UserID": 1, "TailscaleIPs": ["100.64.0.3"],
          "CurAddr": "", "Relay": "sea", "Online": true, "Active": true
        },
        "nodekey:c": {
          "ID": "nLAPTOP", "HostName": "air", "DNSName": "air.tail1234.ts.net.",
          "OS": "macOS", "UserID": 2, "TailscaleIPs": ["100.64.0.4"],
          "CurAddr": "", "Relay": "nyc", "Online": false, "Active": false,
          "LastSeen": "2026-09-20T18:04:00Z", "Expired": true
        }
      },
      "User": {
        "1": { "ID": 1, "LoginName": "pwb@example.com", "DisplayName": "PWB" },
        "2": { "ID": 2, "LoginName": "guest@example.com", "DisplayName": "Guest" }
      }
    }"#;

    fn parsed() -> TailnetStatus {
        serde_json::from_str::<RawStatus>(FIXTURE).unwrap().into_status(42)
    }

    fn device<'a>(status: &'a TailnetStatus, id: &str) -> &'a TailnetDevice {
        status.devices
            .iter()
            .find(|d| d.id == id)
            .unwrap()
    }

    #[test]
    fn self_comes_first_then_peers_by_name() {
        let s = parsed();
        let order: Vec<_> = s.devices
            .iter()
            .map(|d| d.name.as_str())
            .collect();
        assert_eq!(order, ["jupiter", "air", "Desktop", "pixel"]);
        assert!(s.devices[0].is_self);
        assert_eq!(s.tailnet.as_deref(), Some("example.github"));
        assert_eq!(s.backend_state, "Running");
        assert_eq!(s.sampled_at, 42);
    }

    #[test]
    fn reads_the_connection_path_like_the_cli() {
        let s = parsed();
        assert_eq!(device(&s, "nDESK").connection, TailnetConnection::Direct {
            endpoint: "192.168.1.20:41641".into(),
        });
        assert_eq!(device(&s, "nPHONE").connection, TailnetConnection::Relay {
            region: "sea".into(),
        });
        // Offline and idle: no path, whatever its home relay is.
        assert_eq!(device(&s, "nLAPTOP").connection, TailnetConnection::Idle);
        assert_eq!(device(&s, "nSELF").connection, TailnetConnection::Idle);
    }

    #[test]
    fn drops_go_zero_times_and_the_dns_trailing_dot() {
        let s = parsed();
        let desk = device(&s, "nDESK");
        assert_eq!(desk.last_seen, None);
        assert_eq!(desk.key_expiry.as_deref(), Some("2026-12-01T00:00:00Z"));
        assert_eq!(desk.dns_name, "desktop.tail1234.ts.net");

        let air = device(&s, "nLAPTOP");
        assert!(!air.online);
        assert!(air.key_expired);
        assert_eq!(air.last_seen.as_deref(), Some("2026-09-20T18:04:00Z"));
        assert_eq!(air.user.as_deref(), Some("guest@example.com"));
    }

    #[test]
    fn a_logged_out_node_parses_to_no_devices() {
        let s = serde_json
            ::from_str::<RawStatus>(r#"{"BackendState":"NeedsLogin","Peer":null,"User":null}"#)
            .unwrap()
            .into_status(0);
        assert!(s.devices.is_empty());
        assert_eq!(s.tailnet, None);
    }

    #[test]
    fn splits_a_response_and_explains_a_refusal() {
        let ok = b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{\"a\":1}";
        assert_eq!(split_response(ok).unwrap(), b"{\"a\":1}");

        let denied = b"HTTP/1.0 403 Forbidden\r\n\r\nstatus access denied";
        assert!(split_response(denied).unwrap_err().contains("read access"));

        assert!(split_response(b"HTTP/1.0 200 OK\r\n").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reads_status_over_a_unix_socket() {
        use tokio::io::{ AsyncReadExt, AsyncWriteExt };

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tailscaled.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();

        let server = tokio::spawn(async move {
            let (mut conn, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let n = conn.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).to_string();
            let response = format!("HTTP/1.0 200 OK\r\n\r\n{FIXTURE}");
            conn.write_all(response.as_bytes()).await.unwrap();
            request
        });

        let status = poll(&path).await.unwrap();
        assert_eq!(status.devices.len(), 4);

        let request = server.await.unwrap();
        assert!(request.starts_with("GET /localapi/v0/status HTTP/1.0\r\n"));
        assert!(request.contains("Host: local-tailscaled.sock\r\n"));
    }
}
