//! Wake-on-LAN status: which targets are up, and whether a wake worked.
//!
//! One task owns the target list and the in-flight wakes. Handlers never
//! compute state; they read the published snapshot, or send this task a
//! command and wait for it to republish, so a GET straight after an edit or a
//! wake already reflects it.
//!
//! "Up" comes from the target's tailnet device (`online` in the tailnet
//! snapshot), else from its TCP probe. Tailscale is quick to notice a machine
//! coming back, which is the direction that matters here; it can take a few
//! minutes to notice one going to sleep.

use super::tailnet::TailnetSnapshot;
use crate::{
    config::WolConfig,
    error::AgentError,
    events::{ human_duration, EventsHandle, NewEvent },
    store::{ self, StoredTarget, Store },
    wol,
};
use cosmos_common::types::{
    EventCategory,
    Severity,
    WolEntry,
    WolNetwork,
    WolResponse,
    WolState,
    WolTarget,
    WolWake,
};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{ Duration, Instant },
};
use tokio::sync::{ mpsc, oneshot, watch };

const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// Poll faster while something is waking, so the UI sees it come up.
const WAKING_INTERVAL: Duration = Duration::from_secs(2);
const NETWORKS_EVERY: Duration = Duration::from_secs(60);

pub struct WolSnapshot {
    pub json: Arc<str>,
    pub entries: Vec<WolEntry>,
}

enum Command {
    Reload(oneshot::Sender<()>),
    Waking {
        id: String,
        by: String,
        done: oneshot::Sender<()>,
    },
}

#[derive(Clone)]
pub struct WolHandle {
    pub store: Store,
    pub rx: watch::Receiver<Arc<WolSnapshot>>,
    tx: mpsc::Sender<Command>,
}

impl WolHandle {
    /// Re-reads targets after an edit and waits for the new snapshot.
    pub async fn reload(&self) -> Result<(), AgentError> {
        let (done, wait) = oneshot::channel();
        self.send(Command::Reload(done)).await?;
        wait.await.map_err(|_| AgentError::Unavailable("wake-on-lan task stopped".into()))
    }

    /// Starts watching `id` come up after a packet went out.
    pub async fn waking(&self, id: String, by: String) -> Result<(), AgentError> {
        let (done, wait) = oneshot::channel();
        self.send(Command::Waking { id, by, done }).await?;
        wait.await.map_err(|_| AgentError::Unavailable("wake-on-lan task stopped".into()))
    }

    pub fn entry(&self, id: &str) -> Option<WolEntry> {
        self.rx
            .borrow()
            .entries.iter()
            .find(|e| e.target.id == id)
            .cloned()
    }

    async fn send(&self, cmd: Command) -> Result<(), AgentError> {
        self.tx
            .send(cmd).await
            .map_err(|_| AgentError::Unavailable("wake-on-lan task stopped".into()))
    }
}

struct Attempt {
    started: Instant,
    at: i64,
    by: String,
}

/// What the machine looks like right now, from whichever signal it has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Signal {
    Up,
    Down,
    Unknown,
}

pub fn spawn(
    cfg: &WolConfig,
    store: Store,
    tailnet: Option<watch::Receiver<Arc<TailnetSnapshot>>>,
    events: Option<EventsHandle>,
    iface_allowed: impl Fn(&str) -> bool + Send + Sync + 'static
) -> WolHandle {
    let (snap_tx, rx) = watch::channel(
        Arc::new(WolSnapshot { json: r#"{"targets":[],"networks":[],"sampled_at":0}"#.into(), entries: vec![] })
    );
    let (tx, mut cmd_rx) = mpsc::channel::<Command>(16);
    let handle = WolHandle { store: store.clone(), rx, tx };

    let period = Duration::from_millis(cfg.interval_ms);
    let timeout = Duration::from_secs(cfg.wake_timeout_secs);
    let iface_allowed = Arc::new(iface_allowed);

    tokio::spawn(async move {
        let mut targets = load(&store).await;
        let mut waking: HashMap<String, Attempt> = HashMap::new();
        let mut networks: Vec<WolNetwork> = Vec::new();
        let mut networks_at: Option<Instant> = None;

        loop {
            if networks_at.is_none_or(|t| t.elapsed() >= NETWORKS_EVERY) {
                let allowed = iface_allowed.clone();
                networks = tokio::task
                    ::spawn_blocking(move || wol::networks(|n| allowed(n))).await
                    .unwrap_or_default();
                networks_at = Some(Instant::now());
            }

            let entries = evaluate(&store, &mut targets, &mut waking, tailnet.as_ref(), events.as_ref(), timeout).await;
            if !publish(&snap_tx, entries, &networks) {
                return;
            }

            let wait = if waking.is_empty() { period } else { WAKING_INTERVAL };
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                cmd = cmd_rx.recv() => {
                    let Some(cmd) = cmd else { return; };
                    // Apply, republish, then acknowledge, so the caller's
                    // next read sees the change.
                    let done = match cmd {
                        Command::Reload(done) => {
                            targets = load(&store).await;
                            waking.retain(|id, _| targets.iter().any(|t| &t.target.id == id));
                            done
                        }
                        Command::Waking { id, by, done } => {
                            waking.insert(id, Attempt { started: Instant::now(), at: now(), by });
                            done
                        }
                    };
                    let entries = evaluate(&store, &mut targets, &mut waking, tailnet.as_ref(), events.as_ref(), timeout).await;
                    publish(&snap_tx, entries, &networks);
                    let _ = done.send(());
                }
            }
        }
    });

    handle
}

/// Serializes once per change. `false` once nobody is listening.
fn publish(tx: &watch::Sender<Arc<WolSnapshot>>, entries: Vec<WolEntry>, networks: &[WolNetwork]) -> bool {
    let response = WolResponse { targets: entries, networks: networks.to_vec(), sampled_at: now() };
    let json: Arc<str> = serde_json
        ::to_string(&response)
        .unwrap_or_else(|_| "{}".into())
        .into();
    tx.send(Arc::new(WolSnapshot { json, entries: response.targets })).is_ok()
}

async fn load(store: &Store) -> Vec<StoredTarget> {
    match store.call(store::list_targets).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "cannot read wake-on-lan targets");
            Vec::new()
        }
    }
}

async fn evaluate(
    store: &Store,
    targets: &mut [StoredTarget],
    waking: &mut HashMap<String, Attempt>,
    tailnet: Option<&watch::Receiver<Arc<TailnetSnapshot>>>,
    events: Option<&EventsHandle>,
    timeout: Duration
) -> Vec<WolEntry> {
    let tailnet = tailnet.map(|rx| rx.borrow().clone());
    let signals = futures_util::future::join_all(
        targets.iter().map(|t| signal(&t.target, tailnet.as_deref()))
    ).await;

    let mut entries = Vec::with_capacity(targets.len());
    for (t, (signal, last_seen)) in targets.iter_mut().zip(signals) {
        let id = t.target.id.clone();
        let (state, outcome) = step(
            signal,
            waking.get(&id).map(|a| (a.started.elapsed(), a.at, a.by.as_str())),
            t.last_wake.as_ref(),
            timeout
        );

        if let Some(wake) = outcome {
            waking.remove(&id);
            tracing::info!(target = %t.target.name, woke = ?wake.woke, took = ?wake.took_secs, "wake finished");
            let (sid, w) = (id.clone(), wake.clone());
            if let Err(e) = store.call(move |c| store::record_wake(c, &sid, &w)).await {
                tracing::warn!(error = %e, "cannot record wake outcome");
            }
            if let Some(events) = events {
                events.record(wake_event(&t.target.name, &wake));
            }
            t.last_wake = Some(wake);
        }

        let last_wake = match waking.get(&id) {
            Some(a) => Some(WolWake { at: a.at, by: a.by.clone(), woke: None, took_secs: None }),
            None => t.last_wake.clone(),
        };
        entries.push(WolEntry {
            target: t.target.clone(),
            state,
            last_seen: if signal == Signal::Up { None } else { last_seen },
            last_wake,
        });
    }
    entries
}

fn wake_event(name: &str, wake: &WolWake) -> NewEvent {
    let event = |kind, severity, title: String| {
        NewEvent::new(EventCategory::Wol, kind, severity, name, title).actor(wake.by.clone())
    };
    match (wake.woke, wake.took_secs) {
        (Some(true), Some(took)) => event("woke", Severity::Info, format!("{name} woke up")).detail(format!("It came online {} after the magic packet.", human_duration(u64::from(took)))),
        (Some(true), None) => event("woke", Severity::Info, format!("{name} woke up")),
        _ => event("did_not_wake", Severity::Warning, format!("{name} didn't wake")).detail(
            "It never came online after the magic packet. Check it's plugged in and has Wake-on-LAN enabled."
        ),
    }
}

/// The state machine, separate from I/O so it can be tested with a fake
/// clock. `attempt` is (elapsed, started_at, by) for a wake in flight.
/// Returns the state and, when a wake just finished, its outcome to record.
fn step(
    signal: Signal,
    attempt: Option<(Duration, i64, &str)>,
    last_wake: Option<&WolWake>,
    timeout: Duration
) -> (WolState, Option<WolWake>) {
    if let Some((elapsed, at, by)) = attempt {
        if signal == Signal::Up {
            let wake = WolWake {
                at,
                by: by.to_string(),
                woke: Some(true),
                took_secs: Some(elapsed.as_secs().min(u32::MAX as u64) as u32),
            };
            return (WolState::Awake, Some(wake));
        }
        if elapsed >= timeout {
            let wake = WolWake { at, by: by.to_string(), woke: Some(false), took_secs: None };
            return (WolState::DidNotWake, Some(wake));
        }
        return (WolState::Waking, None);
    }

    let state = match signal {
        Signal::Up => WolState::Awake,
        // Stays "didn't wake" until it comes up or someone tries again.
        Signal::Down if last_wake.is_some_and(|w| w.woke == Some(false)) => WolState::DidNotWake,
        Signal::Down => WolState::Asleep,
        Signal::Unknown => WolState::Unknown,
    };
    (state, None)
}

/// The tailnet wins when the target is linked and the device is visible;
/// otherwise the TCP probe; otherwise nothing to go on.
async fn signal(t: &WolTarget, tailnet: Option<&TailnetSnapshot>) -> (Signal, Option<String>) {
    if let (Some(device_id), Some(Ok(data))) = (&t.tailnet_device, tailnet.map(|s| &s.result)) {
        if let Some(d) = data.status.devices.iter().find(|d| &d.id == device_id) {
            let s = if d.online { Signal::Up } else { Signal::Down };
            return (s, d.last_seen.clone());
        }
    }
    if let Some(p) = &t.probe {
        let up = probe(&p.host, p.port).await;
        return (if up { Signal::Up } else { Signal::Down }, None);
    }
    (Signal::Unknown, None)
}

/// A refusal is still an answer: the machine's network stack is up.
async fn probe(host: &str, port: u16) -> bool {
    match tokio::time::timeout(PROBE_TIMEOUT, tokio::net::TcpStream::connect((host, port))).await {
        Ok(Ok(_)) => true,
        Ok(Err(e)) => e.kind() == std::io::ErrorKind::ConnectionRefused,
        Err(_) => false,
    }
}

fn now() -> i64 {
    std::time::SystemTime
        ::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TIMEOUT: Duration = Duration::from_secs(180);

    #[test]
    fn a_wake_completes_when_the_machine_comes_up() {
        let (state, outcome) = step(Signal::Up, Some((Duration::from_secs(23), 1000, "pwb")), None, TIMEOUT);
        assert_eq!(state, WolState::Awake);
        let wake = outcome.unwrap();
        assert_eq!(wake.woke, Some(true));
        assert_eq!(wake.took_secs, Some(23));
        assert_eq!(wake.at, 1000);
        assert_eq!(wake.by, "pwb");
    }

    #[test]
    fn a_wake_keeps_waiting_until_the_timeout() {
        let (state, outcome) = step(Signal::Down, Some((Duration::from_secs(60), 0, "pwb")), None, TIMEOUT);
        assert_eq!(state, WolState::Waking);
        assert!(outcome.is_none());

        let (state, outcome) = step(Signal::Down, Some((TIMEOUT, 0, "pwb")), None, TIMEOUT);
        assert_eq!(state, WolState::DidNotWake);
        assert_eq!(outcome.unwrap().woke, Some(false));
    }

    #[test]
    fn a_failed_wake_sticks_until_the_machine_is_up() {
        let failed = WolWake { at: 0, by: "pwb".into(), woke: Some(false), took_secs: None };
        assert_eq!(step(Signal::Down, None, Some(&failed), TIMEOUT).0, WolState::DidNotWake);
        assert_eq!(step(Signal::Up, None, Some(&failed), TIMEOUT).0, WolState::Awake);

        let worked = WolWake { woke: Some(true), took_secs: Some(9), ..failed };
        assert_eq!(step(Signal::Down, None, Some(&worked), TIMEOUT).0, WolState::Asleep);
        assert_eq!(step(Signal::Unknown, None, None, TIMEOUT).0, WolState::Unknown);
    }

    #[tokio::test]
    async fn probe_counts_a_refusal_as_up() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(probe("127.0.0.1", port).await, "accepting");
        drop(listener);
        assert!(probe("127.0.0.1", port).await, "refusing");
    }

    #[tokio::test]
    async fn waking_then_the_tailnet_reporting_online_completes_the_wake() {
        use crate::sample::tailnet::{ TailnetData, TailnetSnapshot };
        use cosmos_common::types::{ TailnetConnection, TailnetDevice, TailnetStatus };

        let device = |online: bool| TailnetDevice {
            id: "nDESK".into(),
            name: "desktop".into(),
            dns_name: String::new(),
            os: "windows".into(),
            user: None,
            ips: vec![],
            tags: vec![],
            is_self: false,
            online,
            active: false,
            last_seen: (!online).then(|| "2026-09-22T10:00:00Z".into()),
            key_expiry: None,
            key_expired: false,
            connection: TailnetConnection::Idle,
            exit_node: false,
            rx_bytes: 0,
            tx_bytes: 0,
        };
        let snapshot = |online: bool| {
            let status = TailnetStatus {
                tailnet: None,
                backend_state: "Running".into(),
                devices: vec![device(online)],
                sampled_at: 0,
            };
            Arc::new(TailnetSnapshot {
                result: Ok(TailnetData { status: Arc::new(status), json: "{}".into() }),
            })
        };
        let (tailnet_tx, tailnet_rx) = watch::channel(snapshot(false));

        let store = Store::in_memory();
        let saved = store.with(|c| {
            store
                ::insert_target(c, &WolTarget {
                    id: String::new(),
                    name: "desktop".into(),
                    mac: "aa:bb:cc:dd:ee:ff".into(),
                    broadcast: None,
                    port: 9,
                    tailnet_device: Some("nDESK".into()),
                    probe: None,
                })
                .unwrap()
        });

        let cfg = WolConfig { enabled: true, interval_ms: 60_000, wake_timeout_secs: 180 };
        let handle = spawn(&cfg, store.clone(), Some(tailnet_rx), None, |_| true);
        handle.reload().await.unwrap();
        let entry = handle.entry(&saved.id).unwrap();
        assert_eq!(entry.state, WolState::Asleep);
        assert_eq!(entry.last_seen.as_deref(), Some("2026-09-22T10:00:00Z"));

        handle.waking(saved.id.clone(), "pwb".into()).await.unwrap();
        let entry = handle.entry(&saved.id).unwrap();
        assert_eq!(entry.state, WolState::Waking);
        assert_eq!(entry.last_wake.as_ref().unwrap().woke, None);

        tailnet_tx.send(snapshot(true)).unwrap();
        // Waking polls every 2s; wait for the next pass.
        let mut rx = handle.rx.clone();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                rx.changed().await.unwrap();
                if handle.entry(&saved.id).unwrap().state == WolState::Awake {
                    break;
                }
            }
        }).await.expect("the wake should complete");

        let stored = store.with(|c| store::get_target(c, &saved.id).unwrap());
        assert_eq!(stored.last_wake.unwrap().woke, Some(true));
    }
}
