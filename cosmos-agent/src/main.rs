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
mod history;
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

    if cfg.docker.watch_events {
        sample::spawn_event_watcher(docker.clone());
    }
    sample::spawn_self_identification(docker.clone(), facts.hostname.clone());

    let backups_rx = cfg.backups.enabled.then(|| sample::spawn_backups(&cfg));
    let tailnet_rx = cfg.tailscale.enabled.then(|| sample::tailnet::spawn(&cfg.tailscale));

    // Like history, a broken state database disables the feature rather
    // than the agent.
    let wol = if cfg.wol.enabled {
        match store::Store::open(&cfg.state.path) {
            Ok(store) => {
                let filters = sample::filters::HostFilters::from_config(&cfg.host);
                Some(
                    sample::wol::spawn(&cfg.wol, store, tailnet_rx.clone(), move |iface|
                        filters.iface_allowed(iface)
                    )
                )
            }
            Err(e) => {
                tracing::error!(
                    path = %cfg.state.path.display(),
                    error = %e,
                    hint = history::diagnose(&cfg.state.path),
                    "could not open the state database; wake-on-lan is disabled"
                );
                None
            }
        }
    } else {
        None
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
