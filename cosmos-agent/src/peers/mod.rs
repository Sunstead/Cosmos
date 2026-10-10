//! Agents that watch each other: nothing on Jupiter can report Jupiter being
//! down, so another node does.
//!
//! Each `[[peers]]` entry is another agent. One side dials (`url` set): every
//! [`detector::INTERVAL_SECS`] it POSTs a [`PeerHello`] to the other's
//! `/v1/peer/heartbeat`, which answers with its own. One exchange tells both
//! sides the other is alive, so only one has to be able to reach the other:
//! Pluto dials Jupiter, since Jupiter's userspace Tailscale can't reach Pluto.
//!
//! Heartbeats carry a shared secret (`COSMOS_AGENT_PEER_TOKEN`), not a
//! sign-in: the identity provider lives on one of the nodes, and its restart
//! must not look like that node going down. All the token can do is say
//! "I'm alive".
//!
//! One task owns the trackers, like Wake-on-LAN's and uptime's: the handler
//! and the dialler send it what they heard, and it reports
//! `peer:<name>:unreachable` and publishes the status.

pub mod detector;

use crate::{
    config::PeerConfig,
    error::AgentError,
    events::{ human_duration, EventsHandle, ProblemSpec, Report, Resolution },
    sample::{ host::unix_now, tailnet::TailnetSnapshot },
    shutdown::Shutdown,
};
use cosmos_common::types::{
    EventCategory,
    PeerDirection,
    PeerHello,
    PeerState,
    PeerStatus,
    PeersResponse,
    Severity,
};
use detector::{ Change, Tracker };
use std::{ collections::HashMap, sync::Arc, time::{ Duration, Instant } };
use tokio::sync::{ mpsc, watch };

/// How long a peer has to have been back before failures it explains are
/// let through: long enough for an uptime check to see two passes and clear.
pub const SETTLE_SECS: i64 = 5 * 60;
const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
/// How often trackers move on with the clock.
const TICK: Duration = Duration::from_secs(5);

/// The shared secret. Hidden from `Debug`.
#[derive(Clone)]
pub struct PeerToken(pub String);

impl std::fmt::Debug for PeerToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PeerToken(..)")
    }
}

impl PeerToken {
    /// Constant time in the token's content, so a caller can't find it a
    /// byte at a time. The length isn't secret.
    pub fn matches(&self, presented: &str) -> bool {
        let (a, b) = (self.0.as_bytes(), presented.as_bytes());
        a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }
}

pub fn problem_key(name: &str) -> String {
    format!("peer:{name}:unreachable")
}

pub struct PeersSnapshot {
    pub json: Arc<str>,
    trackers: HashMap<String, Tracker>,
}

#[derive(Clone)]
pub struct PeersHandle {
    pub rx: watch::Receiver<Arc<PeersSnapshot>>,
    tx: mpsc::Sender<Heard>,
    token: PeerToken,
    /// Configured peer names, any of which may send heartbeats here.
    names: Arc<[String]>,
    node: Arc<str>,
}

/// A heartbeat, either way, or a dial that failed.
enum Heard {
    Received {
        name: String,
        hello: PeerHello,
    },
    Answered {
        name: String,
        hello: PeerHello,
        latency_ms: u32,
    },
    Failed {
        name: String,
        error: String,
    },
}

fn hello(node: &str, stopping: bool) -> PeerHello {
    PeerHello { node: node.to_string(), version: env!("CARGO_PKG_VERSION").into(), sent_at: unix_now(), stopping }
}

impl PeersHandle {
    /// A heartbeat from a peer: checks it and answers with this agent's.
    pub fn receive(&self, presented: Option<&str>, hello_in: PeerHello) -> Result<PeerHello, AgentError> {
        if !presented.is_some_and(|t| self.token.matches(t)) {
            return Err(AgentError::Unauthorized);
        }
        if !self.names.contains(&hello_in.node) {
            return Err(AgentError::Forbidden(format!("{} isn't one of this agent's peers", hello_in.node)));
        }
        // Never waits: a full queue only loses a heartbeat, and the next
        // one is 15 s away.
        let _ = self.tx.try_send(Heard::Received { name: hello_in.node.clone(), hello: hello_in });
        Ok(hello(&self.node, false))
    }

    /// Whether failures that go through `peer` are explained by it: it's
    /// unreachable, or only just came back. An unknown peer explains nothing.
    pub fn explains(&self, peer: &str, now: i64) -> bool {
        self.rx
            .borrow()
            .trackers.get(peer)
            .is_some_and(|t| t.explains_failures(now, SETTLE_SECS))
    }
}

struct Peer {
    cfg: PeerConfig,
    tracker: Tracker,
    version: Option<String>,
    latency_ms: Option<u32>,
    last_error: Option<String>,
    /// The last heartbeat before it went down, for the recovery's
    /// "unreachable for".
    down_since: Option<i64>,
}

impl Peer {
    fn status(&self) -> PeerStatus {
        PeerStatus {
            name: self.cfg.name.clone(),
            direction: if self.cfg.url.is_some() { PeerDirection::Dial } else { PeerDirection::Listen },
            state: self.tracker.state,
            last_seen: self.tracker.last_seen,
            version: self.version.clone(),
            latency_ms: self.latency_ms,
            last_error: self.last_error.clone(),
            stopping: self.tracker.stopping,
        }
    }
}

pub struct Inputs {
    pub peers: Vec<PeerConfig>,
    pub token: PeerToken,
    pub node: String,
    pub events: Option<EventsHandle>,
    pub tailnet: Option<watch::Receiver<Arc<TailnetSnapshot>>>,
    pub shutdown: Shutdown,
}

pub fn spawn(inputs: Inputs) -> PeersHandle {
    let now = unix_now();
    let peers: Vec<Peer> = inputs.peers
        .into_iter()
        .map(|cfg| Peer {
            cfg,
            tracker: Tracker::new(now),
            version: None,
            latency_ms: None,
            last_error: None,
            down_since: None,
        })
        .collect();
    let names: Arc<[String]> = peers
        .iter()
        .map(|p| p.cfg.name.clone())
        .collect();
    let (snap_tx, rx) = watch::channel(Arc::new(snapshot(&peers)));
    let (tx, heard) = mpsc::channel(64);
    let handle = PeersHandle { rx, tx: tx.clone(), token: inputs.token.clone(), names, node: inputs.node.clone().into() };

    let client = reqwest::Client
        ::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("cosmos-agent/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("reqwest client");

    let task = Task {
        peers,
        client,
        token: inputs.token,
        node: inputs.node,
        events: inputs.events,
        tailnet: inputs.tailnet,
        snap_tx,
        tx,
    };
    tokio::spawn(task.run(heard, inputs.shutdown));
    handle
}

fn snapshot(peers: &[Peer]) -> PeersSnapshot {
    let response = PeersResponse { peers: peers.iter().map(Peer::status).collect() };
    PeersSnapshot {
        json: serde_json::to_string(&response).unwrap_or_else(|_| r#"{"peers":[]}"#.into()).into(),
        trackers: peers
            .iter()
            .map(|p| (p.cfg.name.clone(), p.tracker.clone()))
            .collect(),
    }
}

struct Task {
    peers: Vec<Peer>,
    client: reqwest::Client,
    token: PeerToken,
    node: String,
    events: Option<EventsHandle>,
    tailnet: Option<watch::Receiver<Arc<TailnetSnapshot>>>,
    snap_tx: watch::Sender<Arc<PeersSnapshot>>,
    tx: mpsc::Sender<Heard>,
}

impl Task {
    async fn run(mut self, mut heard: mpsc::Receiver<Heard>, shutdown: Shutdown) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut dial = tokio::time::interval(Duration::from_secs(detector::INTERVAL_SECS as u64));
        dial.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let stopping = shutdown.wait();
        tokio::pin!(stopping);

        loop {
            tokio::select! {
                Some(h) = heard.recv() => self.heard(h),
                _ = tick.tick() => self.tick(),
                _ = dial.tick() => self.dial_all(false),
                () = &mut stopping => {
                    // Tell the peers this is on purpose, so a deploy or a
                    // reboot gets longer before anyone is told.
                    let sends: Vec<_> = self.dials(true).collect();
                    let _ = tokio::time::timeout(Duration::from_secs(2), futures_util::future::join_all(sends)).await;
                    return;
                }
            }
            let _ = self.snap_tx.send(Arc::new(snapshot(&self.peers)));
        }
    }

    fn heard(&mut self, h: Heard) {
        let now = unix_now();
        let (name, change) = match h {
            Heard::Received { name, hello } => {
                let Some(p) = self.peers.iter_mut().find(|p| p.cfg.name == name) else {
                    return;
                };
                p.version = Some(hello.version);
                (name, p.tracker.heard(now, hello.stopping))
            }
            Heard::Answered { name, hello, latency_ms } => {
                let Some(p) = self.peers.iter_mut().find(|p| p.cfg.name == name) else {
                    return;
                };
                p.version = Some(hello.version);
                p.latency_ms = Some(latency_ms);
                p.last_error = None;
                (name, p.tracker.heard(now, hello.stopping))
            }
            Heard::Failed { name, error } => {
                if let Some(p) = self.peers.iter_mut().find(|p| p.cfg.name == name) {
                    p.tracker.missed();
                    p.latency_ms = None;
                    p.last_error = Some(error);
                }
                return;
            }
        };
        let Some(p) = self.peers.iter_mut().find(|p| p.cfg.name == name) else {
            return;
        };
        let Some(events) = &self.events else {
            return;
        };
        let key = problem_key(&name);
        match change {
            Some(Change::CameBack) => {
                let down_for = p.down_since.take().map(|t| human_duration((now - t).max(0) as u64));
                events.report(
                    Report::Resolve(Resolution {
                        key,
                        title: format!("{name} is answering again"),
                        detail: down_for.map(|d| format!("It was unreachable for {d}.")),
                    })
                );
            }
            // Up without coming back from down: either it never went, or
            // this agent restarted while a problem was open. Resolving a
            // closed problem does nothing.
            _ if p.tracker.state == PeerState::Up && events.open_problems().iter().any(|o| o.key == key) => {
                events.report(Report::Resolve(Resolution { key, title: format!("{name} is answering again"), detail: None }));
            }
            _ => {}
        }
    }

    fn tick(&mut self) {
        let now = unix_now();
        let tailnet = self.tailnet.as_ref().map(|rx| rx.borrow().clone());
        for p in &mut self.peers {
            if p.tracker.tick(now) != Some(Change::WentDown) {
                continue;
            }
            // From the last word from it, not from when it was called down.
            p.down_since = Some(p.tracker.last_seen.unwrap_or(now));
            tracing::warn!(peer = %p.cfg.name, error = ?p.last_error, "peer unreachable");
            let Some(events) = &self.events else {
                continue;
            };
            let name = &p.cfg.name;
            events.report(
                Report::Open(ProblemSpec {
                    key: problem_key(name),
                    category: EventCategory::Peer,
                    kind: "unreachable",
                    severity: Severity::Error,
                    subject: name.clone(),
                    title: format!("{name} isn't answering"),
                    detail: Some(down_detail(p, tailnet.as_deref(), now)),
                    service: None,
                    depends_on: None,
                })
            );
        }
    }

    /// One heartbeat to every peer this agent dials, as futures.
    fn dials(&self, stopping: bool) -> impl Iterator<Item = impl std::future::Future<Output = ()>> + '_ {
        self.peers.iter().filter_map(move |p| {
            let url = format!("{}/v1/peer/heartbeat", p.cfg.url.as_deref()?.trim_end_matches('/'));
            let (client, tx, name) = (self.client.clone(), self.tx.clone(), p.cfg.name.clone());
            let req = client.post(url).bearer_auth(&self.token.0).json(&hello(&self.node, stopping));
            Some(async move {
                let started = Instant::now();
                let heard = match send(req).await {
                    Ok(hello) =>
                        Heard::Answered {
                            name,
                            hello,
                            latency_ms: started.elapsed().as_millis().min(u32::MAX as u128) as u32,
                        },
                    Err(error) => Heard::Failed { name, error },
                };
                let _ = tx.send(heard).await;
            })
        })
    }

    /// Each in its own task, so a slow peer doesn't hold up the loop.
    fn dial_all(&self, stopping: bool) {
        for d in self.dials(stopping) {
            tokio::spawn(d);
        }
    }
}

async fn send(req: reqwest::RequestBuilder) -> Result<PeerHello, String> {
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() { "timed out".to_string() } else if e.is_connect() { "couldn't connect".to_string() } else { e.to_string() }
    })?;
    match res.status() {
        s if s.is_success() => res.json::<PeerHello>().await.map_err(|_| "answered with something that isn't a heartbeat".into()),
        reqwest::StatusCode::UNAUTHORIZED => Err("it refused the peer token".into()),
        reqwest::StatusCode::FORBIDDEN => Err("it doesn't list this agent as a peer".into()),
        reqwest::StatusCode::NOT_FOUND => Err("it has no heartbeat route (an agent older than 0.11?)".into()),
        s => Err(format!("HTTP {}", s.as_u16())),
    }
}

/// Why it might be down, from what this side knows.
fn down_detail(p: &Peer, tailnet: Option<&TailnetSnapshot>, now: i64) -> String {
    let quiet = now - p.tracker.last_seen.unwrap_or(now);
    let mut detail = match (&p.cfg.url, &p.last_error, p.tracker.last_seen) {
        (Some(_), Some(e), _) => format!("Heartbeats to it fail: {e}."),
        (_, _, Some(_)) => format!("Nothing from it for {}.", human_duration(quiet.max(0) as u64)),
        (_, _, None) => "Nothing from it since this agent started.".to_string(),
    };
    if p.tracker.stopping {
        detail.push_str(" It said it was shutting down.");
    }
    let device = p.cfg.tailnet_name.as_deref().unwrap_or(&p.cfg.name);
    let online = tailnet
        .and_then(|t| t.result.as_ref().ok())
        .and_then(|t| t.status.devices.iter().find(|d| d.name.eq_ignore_ascii_case(device)).map(|d| d.online));
    match online {
        Some(true) =>
            detail.push_str(" The tailnet sees it online, so the machine is up and the agent, or what's in front of it, isn't answering."),
        Some(false) => detail.push_str(" The tailnet sees it offline too: the machine or its network is down."),
        None => {}
    }
    detail
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_must_match_exactly() {
        let t = PeerToken("a".repeat(32));
        assert!(t.matches(&"a".repeat(32)));
        assert!(!t.matches(&"a".repeat(31)));
        assert!(!t.matches(&format!("{}b", "a".repeat(31))));
        assert!(!format!("{t:?}").contains('a'));
    }

    fn peer(url: Option<&str>) -> Peer {
        Peer {
            cfg: PeerConfig { name: "jupiter".into(), url: url.map(str::to_string), ui_url: None, tailnet_name: None },
            tracker: Tracker::new(0),
            version: None,
            latency_ms: None,
            last_error: None,
            down_since: None,
        }
    }

    #[test]
    fn says_why_from_what_it_knows() {
        let mut p = peer(Some("https://cosmos.example.net"));
        p.last_error = Some("timed out".into());
        assert_eq!(down_detail(&p, None, 60), "Heartbeats to it fail: timed out.");

        let mut p = peer(None);
        p.tracker.heard(0, true);
        assert_eq!(down_detail(&p, None, 300), "Nothing from it for 5m. It said it was shutting down.");
        assert_eq!(down_detail(&peer(None), None, 60), "Nothing from it since this agent started.");
    }
}
