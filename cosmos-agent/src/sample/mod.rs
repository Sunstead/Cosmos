//! Sampler orchestration. Each source is sampled on one schedule and published
//! to a `watch` channel, so cost and rate deltas are independent of client
//! count. `watch` over `broadcast`: subscribers only want the latest value.

pub mod docker;
pub mod facts;
pub mod filters;
pub mod host;

use crate::{
    backups::{ BackupSnapshot, BackupsProvider },
    config::Config,
    docker::DockerHandle,
    history::HistoryHandle,
};
use docker::{ ContainerSnapshot, DockerProbe, VolumeSnapshot };
use facts::HostFacts;
use filters::HostFilters;
use futures_util::StreamExt;
use host::{ HostProbe, HostSnapshot };
use std::{ sync::Arc, time::{ Duration, Instant } };
use tokio::sync::watch;

/// Host metrics, sampled on a dedicated OS thread.
///
/// A thread rather than a tokio task because `sysinfo` does blocking `/proc`
/// reads, and because the loop owns `&mut System` for its entire life — so
/// there is no lock anywhere on this path, and a slow `/proc` can never stall
/// the HTTP runtime.
pub fn spawn_host(
    cfg: &Config,
    facts: Arc<HostFacts>,
    history: Option<HistoryHandle>
) -> watch::Receiver<Arc<HostSnapshot>> {
    let filters = Arc::new(HostFilters::from_config(&cfg.host));
    let period = Duration::from_millis(cfg.host.interval_ms);

    let mut probe = HostProbe::new(filters);
    let first = Arc::new(HostSnapshot::new(0, probe.sample(), &facts));
    let (tx, rx) = watch::channel(first);

    std::thread::Builder
        ::new()
        .name("host-sampler".into())
        .spawn(move || {
            let mut next = Instant::now();
            let mut seq: u64 = 0;

            loop {
                // Absolute-deadline scheduling: no cumulative drift. If we
                // fell behind (host suspend, heavy load), snap forward rather
                // than spin through a burst of catch-up ticks, which is what
                // tokio's default MissedTickBehavior::Burst would do.
                next += period;
                let now = Instant::now();
                if next < now {
                    next = now + period;
                }
                std::thread::sleep(next.saturating_duration_since(now));

                seq = seq.wrapping_add(1);
                let sample = probe.sample();

                if let Some(h) = &history {
                    h.push(&sample);
                }

                // Errors here mean every receiver was dropped, which only
                // happens during shutdown — AppState holds one for the life
                // of the process.
                if tx.send(Arc::new(HostSnapshot::new(seq, sample, &facts))).is_err() {
                    tracing::debug!("host sampler stopping: no receivers");
                    return;
                }
            }
        })
        .expect("spawn host-sampler");

    rx
}

/// Containers. Async because it's all Docker I/O.
pub fn spawn_containers(
    cfg: &Config,
    docker: DockerHandle
) -> watch::Receiver<Arc<ContainerSnapshot>> {
    let (tx, rx) = watch::channel(Arc::new(ContainerSnapshot::empty()));
    let period = Duration::from_millis(cfg.docker.interval_ms);
    let mut probe = DockerProbe::new(cfg.docker.stats_concurrency);

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut failing = false;

        loop {
            // Either the interval elapses, or a Docker event says something
            // changed. The event path is what makes the action buttons feel
            // instant instead of waiting out a 2s tick.
            tokio::select! {
                _ = ticker.tick() => {}
                _ = docker.notify().notified() => {}
            }

            let Some(client) = docker.try_reconnect() else {
                continue;
            };

            match probe.sample(&client).await {
                Ok(snapshot) => {
                    if failing {
                        tracing::info!("docker container sampling recovered");
                        failing = false;
                    }
                    if tx.send(Arc::new(snapshot)).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    // Log the transition, not every tick — otherwise a dead
                    // socket writes a line every two seconds forever.
                    if !failing {
                        tracing::warn!(error = %e, "docker container sampling failed");
                        failing = true;
                    }
                    docker.mark_disconnected();
                }
            }
        }
    });

    rx
}

/// Volumes change rarely, so this runs slowly and relies on Docker events for
/// anything that happens in between.
pub fn spawn_volumes(docker: DockerHandle) -> watch::Receiver<Arc<VolumeSnapshot>> {
    let (tx, rx) = watch::channel(Arc::new(VolumeSnapshot::empty()));

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut failing = false;

        loop {
            ticker.tick().await;

            let Some(client) = docker.client() else {
                continue;
            };
            match docker::sample_volumes(&client).await {
                Ok(snapshot) => {
                    failing = false;
                    if tx.send(Arc::new(snapshot)).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    if !failing {
                        tracing::warn!(error = %e, "docker volume sampling failed");
                        failing = true;
                    }
                }
            }
        }
    });

    rx
}

/// Watches the Docker event stream and pokes the container sampler.
pub fn spawn_event_watcher(docker: DockerHandle) {
    tokio::spawn(async move {
        loop {
            let Some(client) = docker.client() else {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            };

            let mut filters = std::collections::HashMap::new();
            filters.insert("type".to_string(), vec![
                "container".to_string(),
                "volume".to_string()
            ]);

            let mut events = client.events(
                Some(bollard::system::EventsOptions {
                    filters,
                    ..Default::default()
                })
            );

            tracing::debug!("watching docker events");
            while let Some(event) = events.next().await {
                match event {
                    Ok(_) => docker.notify().notify_waiters(),
                    Err(e) => {
                        tracing::debug!(error = %e, "docker event stream ended");
                        break;
                    }
                }
            }

            // The stream ends when dockerd restarts. Back off before
            // resubscribing so a down daemon isn't hammered.
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// Backups. A file poll, so it's cheap enough to run on the async runtime.
pub fn spawn_backups(cfg: &Config) -> watch::Receiver<Arc<BackupSnapshot>> {
    let mut provider = BackupsProvider::new(cfg.backups.clone());
    let initial = provider.poll(false).expect("first backups poll always yields a snapshot");
    let (tx, rx) = watch::channel(Arc::new(initial));

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;
            if let Some(snapshot) = provider.poll(true) {
                if tx.send(Arc::new(snapshot)).is_err() {
                    return;
                }
            }
        }
    });

    rx
}

/// Identifies the agent's own container so actions against it can be refused.
pub fn spawn_self_identification(docker: DockerHandle, hostname: String) {
    tokio::spawn(async move {
        let Some(client) = docker.client() else {
            return;
        };
        if let Some(id) = crate::docker::resolve_self_id(&client, &hostname).await {
            tracing::info!(container = %&id[..12.min(id.len())], "identified own container");
            docker.set_self_id(Some(id));
        }
    });
}
