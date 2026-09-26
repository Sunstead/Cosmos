//! cosmos-agent — the per-node half of Cosmos.
//!
//! Design in one line: **sample on a schedule, never on the request path.**
//! Background samplers publish to `watch` channels; HTTP handlers hand out the
//! latest value, already serialized. A request does no collection, no
//! serialization and takes no locks.

mod api;
mod auth;
mod backups;
mod config;
mod docker;
mod error;
mod events;
mod history;
mod notify;
mod sample;
mod sse;
mod state;
mod store;
mod wol;

use config::Config;
use docker::DockerHandle;
use sample::facts::HostFacts;
use state::{ AppState, Inner };
use std::{ process::ExitCode, sync::Arc };

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("cosmos-agent: fatal: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing();

    let cfg = Config::load()?;
    // Decided before anything is bound, so a misconfigured agent fails fast
    // rather than coming up open.
    let mode = cfg.auth_mode()?;
    match mode {
        config::AuthMode::Anonymous =>
            tracing::warn!(
                "running WITHOUT authentication (auth.allow_anonymous = true); \
                 anyone who can reach this port can read this node"
            ),
        config::AuthMode::Oidc { ignored_token: true } =>
            tracing::warn!("ignoring the old shared token; sign-in is through [auth.oidc] now"),
        config::AuthMode::Oidc { .. } => {}
    }

    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
    runtime.block_on(serve(cfg, mode))
}

fn init_tracing() {
    use tracing_subscriber::{ fmt, prelude::*, EnvFilter };

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_|
        EnvFilter::new("info,cosmos_agent=info")
    );
    // Colour only on a terminal; `docker logs` would show raw escape codes.
    let ansi = std::io::IsTerminal::is_terminal(&std::io::stdout());
    tracing_subscriber
        ::registry()
        .with(fmt::layer().compact().with_ansi(ansi))
        .with(filter)
        .init();
}

async fn serve(cfg: Config, mode: config::AuthMode) -> Result<(), Box<dyn std::error::Error>> {
    let cfg = Arc::new(cfg);

    let facts = Arc::new(HostFacts::probe(cfg.node_name.as_deref()));
    tracing::info!(
        node = %facts.node_name,
        os = %facts.os,
        arch = %facts.arch,
        cores = facts.cpu_logical_cores,
        "cosmos-agent {} starting",
        env!("CARGO_PKG_VERSION")
    );

    // History is optional: a failure to open it must not stop the agent from
    // serving live metrics, which is its primary job.
    let history = if cfg.history.enabled {
        match history::HistoryHandle::open(&cfg.history) {
            Ok(h) => {
                tracing::info!(path = %cfg.history.path.display(), "metrics history enabled");
                Some(h)
            }
            Err(e) => {
                tracing::error!(
                    path = %cfg.history.path.display(),
                    error = %e,
                    hint = history::diagnose(&cfg.history.path),
                    "could not open metrics history; continuing without it"
                );
                None
            }
        }
    } else {
        None
    };

    let docker = DockerHandle::new(cfg.docker.socket.clone());

    let host_rx = sample::spawn_host(&cfg, facts.clone(), history.clone());
    let containers_rx = sample::spawn_containers(&cfg, docker.clone());
    let volumes_rx = sample::spawn_volumes(docker.clone());

    sample::spawn_self_identification(docker.clone(), facts.hostname.clone());

    let backups_rx = cfg.backups.enabled.then(|| sample::spawn_backups(&cfg));
    let tailnet_rx = cfg.tailscale.enabled.then(|| sample::tailnet::spawn(&cfg.tailscale));

    // Like history, a broken state database disables the features that
    // need it rather than the agent.
    let store = if cfg.wol.enabled || cfg.events.enabled {
        match store::Store::open(&cfg.state.path) {
            Ok(store) => Some(store),
            Err(e) => {
                tracing::error!(
                    path = %cfg.state.path.display(),
                    error = %e,
                    hint = history::diagnose(&cfg.state.path),
                    "could not open the state database; wake-on-lan and the event log are disabled"
                );
                None
            }
        }
    } else {
        None
    };

    let events = match (&store, cfg.events.enabled) {
        (Some(store), true) =>
            match events::spawn(&cfg.events, store.clone()).await {
                Ok(handle) => Some(handle),
                Err(e) => {
                    tracing::error!(error = %e, "could not start the event log");
                    None
                }
            }
        _ => None,
    };

    // Before anything reports: the notifier only hears events stored after it
    // subscribes, and the lifecycle check below reports straight away.
    let notify = events
        .as_ref()
        .map(|events| notify::spawn(events.store.clone(), events, facts.node_name.clone()));

    // The container tracker needs the Docker event stream even when the
    // samplers don't.
    let forward = events.as_ref().map(|events| {
        let (tx, rx) = tokio::sync::mpsc::channel(256);
        events::containers::spawn(events.clone(), rx, containers_rx.clone());
        tx
    });
    if cfg.docker.watch_events || forward.is_some() {
        sample::spawn_event_watcher(docker.clone(), cfg.docker.watch_events, forward);
    }

    if let Some(events) = &events {
        if let Err(e) = events::lifecycle::start(events, facts.node_name.clone()).await {
            tracing::warn!(error = %e, "cannot compare this run with the last");
        }
        events::disks::spawn(
            events.clone(),
            host_rx.clone(),
            cfg.events.disk_warn_pct,
            cfg.events.disk_critical_pct
        );
        if let Some(backups_rx) = &backups_rx {
            events::backups::spawn(events.clone(), backups_rx.clone());
        }
    }

    let wol = match (&store, cfg.wol.enabled) {
        (Some(store), true) => {
            let filters = sample::filters::HostFilters::from_config(&cfg.host);
            Some(
                sample::wol::spawn(&cfg.wol, store.clone(), tailnet_rx.clone(), events.clone(), move |iface|
                    filters.iface_allowed(iface)
                )
            )
        }
        _ => None,
    };

    let state = AppState::new(Inner {
        auth: match (mode, &cfg.auth.oidc) {
            (config::AuthMode::Oidc { .. }, Some(oidc)) => auth::Auth::oidc(oidc, cfg.auth.allow_query_token),
            _ => auth::Auth::anonymous(cfg.auth.allow_query_token),
        },
        facts,
        docker,
        history,
        host_rx,
        containers_rx,
        volumes_rx,
        backups_rx,
        tailnet_rx,
        wol,
        events: events.clone(),
        notify,
        cfg: cfg.clone(),
    });

    let app = api::router(state);
    let listener = tokio::net::TcpListener::bind(cfg.server.bind).await.map_err(|e| {
        format!("cannot bind {}: {e}", cfg.server.bind)
    })?;

    tracing::info!(
        addr = %cfg.server.bind,
        actions = cfg.allow_actions,
        "listening"
    );

    axum
        ::serve(listener, app)
        // Under Compose, `docker compose down` sends SIGTERM. Without this the
        // history writer's in-flight batch is lost.
        .with_graceful_shutdown(shutdown_signal()).await?;

    // Only reached after a signal, so the next start knows this wasn't a
    // crash or a power cut.
    if let Some(events) = &events {
        events::lifecycle::stopped_cleanly(&events.store).await;
    }

    tracing::info!("shutdown complete");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => {
                tracing::warn!(error = %e, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("received interrupt, shutting down"),
        _ = terminate => tracing::info!("received SIGTERM, shutting down"),
    }
}
