//! What happened to the agent and its host between runs: an upgrade, a
//! reboot, a power cut, a crash.
//!
//! Three markers in the `meta` table carry this across restarts: the agent's
//! version, the host's boot time, and whether the agent last stopped cleanly.
//! A clean stop is written on SIGTERM, which is what `docker compose`, a
//! deploy and an orderly host shutdown all send. A host that rebooted without
//! one lost power or crashed.

use super::{ db, EventsHandle, NewEvent };
use crate::{ backups::format_rfc3339, error::AgentError, store::Store };
use cosmos_common::types::{ EventCategory, Severity };

const VERSION: &str = "agent_version";
const BOOT_TIME: &str = "boot_time";
const CLEAN_STOP: &str = "clean_stop";

/// Boot time is derived from uptime, so it wobbles by a second or so.
const BOOT_TOLERANCE: u64 = 60;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Previous {
    pub version: Option<String>,
    pub boot_time: Option<u64>,
    pub clean_stop: bool,
}

pub fn on_start(prev: &Previous, node: &str, version: &str, boot_time: u64) -> Vec<NewEvent> {
    let event = |kind, severity, title: String| NewEvent::new(EventCategory::Agent, kind, severity, node, title);
    let mut out = Vec::new();

    let first = prev.version.is_none() && prev.boot_time.is_none();
    let rebooted = prev.boot_time.is_some_and(|b| b.abs_diff(boot_time) > BOOT_TOLERANCE);
    let booted = format!("It booted at {}.", format_rfc3339(boot_time as i64));

    if rebooted && prev.clean_stop {
        out.push(event("host_rebooted", Severity::Info, format!("{node} rebooted")).detail(booted));
    } else if rebooted {
        out.push(
            event("host_rebooted", Severity::Warning, format!("{node} restarted unexpectedly")).detail(
                format!("{booted} Nothing shut it down first: a power cut, a crash or a hard reset.")
            )
        );
    } else if !first && !prev.clean_stop {
        out.push(
            event("unclean_shutdown", Severity::Warning, "The agent stopped unexpectedly".into()).detail(
                "It wasn't shut down cleanly. It may have crashed or been killed for using too much memory."
            )
        );
    }

    match &prev.version {
        Some(v) if v != version => {
            out.push(event("upgraded", Severity::Info, format!("Cosmos agent upgraded to {version}")).detail(format!("It was {v}.")));
        }
        _ => out.push(event("started", Severity::Info, format!("Cosmos agent {version} started"))),
    }
    out
}

/// Records what changed since the last run, then marks this run as not yet
/// stopped cleanly.
pub async fn start(events: &EventsHandle, node: String) -> Result<(), AgentError> {
    let boot_time = sysinfo::System::boot_time();
    let version = env!("CARGO_PKG_VERSION");
    let prev = events.store
        .call(|c| {
            Ok(Previous {
                version: db::meta_get(c, VERSION)?,
                boot_time: db::meta_get(c, BOOT_TIME)?.and_then(|b| b.parse().ok()),
                clean_stop: db::meta_get(c, CLEAN_STOP)?.as_deref() == Some("1"),
            })
        }).await?;
    for e in on_start(&prev, &node, version, boot_time) {
        events.record(e);
    }
    events.store.call(move |c| {
        db::meta_set(c, VERSION, version)?;
        db::meta_set(c, BOOT_TIME, &boot_time.to_string())?;
        db::meta_set(c, CLEAN_STOP, "0")
    }).await
}

/// Called once the server has shut down in response to a signal.
pub async fn stopped_cleanly(store: &Store) {
    if let Err(e) = store.call(|c| db::meta_set(c, CLEAN_STOP, "1")).await {
        tracing::warn!(error = %e, "cannot record a clean stop");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOOT: u64 = 1_790_000_000;

    fn prev(version: &str, boot: u64, clean: bool) -> Previous {
        Previous { version: Some(version.into()), boot_time: Some(boot), clean_stop: clean }
    }

    fn titles(events: &[NewEvent]) -> Vec<(&'static str, Severity, String)> {
        events.iter().map(|e| (e.kind, e.severity, e.title.clone())).collect()
    }

    #[test]
    fn the_first_start_is_just_a_start() {
        let out = on_start(&Previous::default(), "jupiter", "0.5.0", BOOT);
        assert_eq!(titles(&out), [("started", Severity::Info, "Cosmos agent 0.5.0 started".into())]);
    }

    #[test]
    fn a_deploy_restart_is_quiet() {
        let out = on_start(&prev("0.5.0", BOOT, true), "jupiter", "0.5.0", BOOT + 1);
        assert_eq!(titles(&out), [("started", Severity::Info, "Cosmos agent 0.5.0 started".into())]);
    }

    #[test]
    fn an_upgrade_names_both_versions() {
        let out = on_start(&prev("0.4.0", BOOT, true), "jupiter", "0.5.0", BOOT);
        assert_eq!(out[0].title, "Cosmos agent upgraded to 0.5.0");
        assert_eq!(out[0].detail.as_deref(), Some("It was 0.4.0."));
    }

    #[test]
    fn a_reboot_is_expected_only_after_a_clean_stop() {
        let planned = on_start(&prev("0.5.0", BOOT, true), "jupiter", "0.5.0", BOOT + 86_400);
        assert_eq!(planned[0].kind, "host_rebooted");
        assert_eq!(planned[0].severity, Severity::Info);

        let power_cut = on_start(&prev("0.5.0", BOOT, false), "jupiter", "0.5.0", BOOT + 86_400);
        assert_eq!(power_cut[0].title, "jupiter restarted unexpectedly");
        assert_eq!(power_cut[0].severity, Severity::Warning);
    }

    #[test]
    fn a_crash_without_a_reboot_is_the_agent() {
        let out = on_start(&prev("0.5.0", BOOT, false), "jupiter", "0.5.0", BOOT);
        assert_eq!(titles(&out)[0], ("unclean_shutdown", Severity::Warning, "The agent stopped unexpectedly".into()));
    }
}
