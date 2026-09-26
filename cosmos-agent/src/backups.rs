//! Read-only restic status.
//!
//! The agent does **not** run restic. It reads a small JSON file that the
//! backup job writes on the host after each run. That choice is deliberate:
//!
//! - The restic repository password never enters a network-facing process.
//! - `restic stats` takes a repository lock; polling it on a timer could make
//!   a real backup fail. A monitoring feature must never be able to break the
//!   thing it monitors.
//! - Reading a file is O(1) and works with the container fully sandboxed.
//!
//! `next_run` and `last_exit_code` come from the host too, because systemd is
//! not reachable from inside a container without mounting its private socket,
//! which is equivalent to granting root on the host.

use crate::config::BackupsConfig;
use cosmos_common::types::{ BackupSnapshotInfo, BackupsStatus, RetentionPolicy, StepStatus };
use serde::Deserialize;
use std::{ path::Path, sync::Arc, time::SystemTime };

/// The on-disk contract with the backup script. Everything is optional so an
/// older or partially-written script still produces a useful page.
#[derive(Debug, Deserialize)]
struct StatusFile {
    generated_at: String,
    #[serde(default)]
    last_run: Option<String>,
    #[serde(default)]
    next_run: Option<String>,
    #[serde(default)]
    last_exit_code: Option<i32>,
    #[serde(default)]
    duration_secs: Option<u64>,
    #[serde(default)]
    repo_size_bytes: Option<u64>,
    #[serde(default)]
    snapshots: Vec<BackupSnapshotInfo>,
    #[serde(default)]
    retention: Option<RetentionPolicy>,
    #[serde(default)]
    postgres_dump: Option<StepStatus>,
    #[serde(default)]
    state_copy: Option<StepStatus>,
    #[serde(default)]
    space_check: Option<StepStatus>,
    #[serde(default)]
    heartbeat: Option<StepStatus>,
}

/// The serialized form for HTTP responses, and the typed status for the
/// event log, which opens a problem when a backup fails or goes stale.
pub struct BackupSnapshot {
    pub json: Arc<str>,
    pub status: Arc<BackupsStatus>,
}

impl BackupSnapshot {
    fn new(status: BackupsStatus) -> Self {
        let json: Arc<str> = serde_json
            ::to_string(&status)
            .unwrap_or_else(|_| "{}".to_string())
            .into();
        Self { json, status: Arc::new(status) }
    }
}

pub struct BackupsProvider {
    cfg: BackupsConfig,
    /// mtime of the status file at the last successful parse, so an unchanged
    /// file costs one `stat` rather than a parse.
    last_mtime: Option<SystemTime>,
}

impl BackupsProvider {
    pub fn new(cfg: BackupsConfig) -> Self {
        Self { cfg, last_mtime: None }
    }

    /// Produces the current snapshot.
    ///
    /// `had_previous` is accepted for symmetry with a cache that skips
    /// re-reading an unchanged file — but staleness is a function of
    /// wall-clock time, not of the file, so a status that stopped being
    /// written still has to be re-evaluated. That's precisely the case the
    /// page exists to catch, so the read happens either way; the mtime is
    /// tracked only to log transitions.
    pub fn poll(&mut self, _had_previous: bool) -> Option<BackupSnapshot> {
        let mtime = std::fs
            ::metadata(&self.cfg.status_file)
            .and_then(|m| m.modified())
            .ok();

        if mtime != self.last_mtime {
            if mtime.is_some() {
                tracing::debug!(
                    path = %self.cfg.status_file.display(),
                    "backup status file changed"
                );
            }
            self.last_mtime = mtime;
        }

        Some(BackupSnapshot::new(self.build()))
    }

    /// The typed status, before serialization.
    fn build(&self) -> BackupsStatus {
        let raw = match std::fs::read_to_string(&self.cfg.status_file) {
            Ok(raw) => raw,
            Err(e) => {
                tracing::debug!(
                    path = %self.cfg.status_file.display(),
                    error = %e,
                    "backup status file unreadable"
                );
                return self.missing();
            }
        };

        let file: StatusFile = match serde_json::from_str(&raw) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(
                    path = %self.cfg.status_file.display(),
                    error = %e,
                    "backup status file is not valid JSON"
                );
                return self.missing();
            }
        };

        let stale = is_stale(&file.generated_at, self.cfg.expected_interval_secs);

        BackupsStatus {
            stale,
            timer_last_fired: self.timer_last_fired(),
            // From config, never the real repository path.
            repo_label: self.cfg.repo_label.clone(),
            snapshot_count: file.snapshots.len() as u32,
            generated_at: file.generated_at,
            last_run: file.last_run,
            next_run: file.next_run,
            last_exit_code: file.last_exit_code,
            duration_secs: file.duration_secs,
            repo_size_bytes: file.repo_size_bytes,
            snapshots: file.snapshots,
            retention: file.retention,
            postgres_dump: file.postgres_dump,
            state_copy: file.state_copy,
            space_check: file.space_check,
            heartbeat: file.heartbeat,
        }
    }

    /// What we report when the status file is absent or unreadable. `stale` is
    /// true, which is the honest answer: we have no evidence a backup ran.
    fn missing(&self) -> BackupsStatus {
        BackupsStatus {
            generated_at: String::new(),
            stale: true,
            last_run: None,
            next_run: None,
            timer_last_fired: self.timer_last_fired(),
            last_exit_code: None,
            duration_secs: None,
            repo_label: self.cfg.repo_label.clone(),
            repo_size_bytes: None,
            snapshot_count: 0,
            snapshots: Vec::new(),
            retention: None,
            postgres_dump: None,
            state_copy: None,
            space_check: None,
            heartbeat: None,
        }
    }

    /// The systemd timer stamp file's mtime equals the last time the timer
    /// fired. Reading it is an independent signal: if this is newer than
    /// `generated_at`, the timer fired but the job died before writing status.
    fn timer_last_fired(&self) -> Option<String> {
        let path = self.cfg.timer_stamp.as_ref()?;
        mtime_rfc3339(path)
    }
}

fn mtime_rfc3339(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let secs = modified.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs();
    Some(format_rfc3339(secs as i64))
}

/// True when the status is older than 1.5x the interval we expect backups on.
///
/// The 0.5 of slack absorbs a job that starts late or runs long without
/// crying wolf, while still catching a timer that has actually stopped.
fn is_stale(generated_at: &str, expected_interval_secs: u64) -> bool {
    let Some(generated) = parse_rfc3339(generated_at) else {
        return true;
    };
    let now = crate::sample::host::unix_now();
    let allowed = ((expected_interval_secs as f64) * 1.5) as i64;
    now - generated > allowed
}

/// Minimal RFC3339 parser for the `YYYY-MM-DDTHH:MM:SS` prefix, which is all
/// the backup script emits. Avoids a date-time dependency for two functions.
pub(crate) fn parse_rfc3339(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let num = |range: std::ops::Range<usize>| -> Option<i64> { s.get(range)?.parse().ok() };

    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, min, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let days = days_from_civil(year, month, day);
    let mut secs = days * 86_400 + hour * 3_600 + min * 60 + sec;

    // Honour a numeric offset if present; `Z` and a bare timestamp are UTC.
    if let Some(sign_at) = bytes.iter().rposition(|&b| (b == b'+') | (b == b'-')) {
        if sign_at >= 19 {
            let oh: i64 = s.get(sign_at + 1..sign_at + 3).and_then(|v| v.parse().ok())?;
            let om: i64 = s.get(sign_at + 4..sign_at + 6).and_then(|v| v.parse().ok()).unwrap_or(0);
            let offset = oh * 3_600 + om * 60;
            secs += if bytes[sign_at] == b'+' { -offset } else { offset };
        }
    }
    Some(secs)
}

pub(crate) fn format_rfc3339(unix: i64) -> String {
    let (days, rem) = (unix.div_euclid(86_400), unix.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

// Howard Hinnant's civil-date algorithms — exact, branch-light, no dependency.
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_civil_dates() {
        for unix in [0i64, 1_700_000_000, 946_684_800, 2_000_000_000] {
            let formatted = format_rfc3339(unix);
            assert_eq!(parse_rfc3339(&formatted), Some(unix), "round trip of {formatted}");
        }
    }

    #[test]
    fn parses_known_timestamps() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2024-01-01T00:00:00Z"), Some(1_704_067_200));
        // A numeric offset shifts to UTC.
        assert_eq!(parse_rfc3339("2024-01-01T01:00:00+01:00"), Some(1_704_067_200));
        assert_eq!(parse_rfc3339("2024-01-01T00:00:00-01:00"), Some(1_704_070_800));
    }

    #[test]
    fn rejects_garbage_rather_than_guessing() {
        assert_eq!(parse_rfc3339(""), None);
        assert_eq!(parse_rfc3339("not-a-date"), None);
        assert_eq!(parse_rfc3339("2024-13-01T00:00:00Z"), None, "month 13");
        assert_eq!(parse_rfc3339("2024-01-99T00:00:00Z"), None, "day 99");
    }

    #[test]
    fn an_unparseable_timestamp_counts_as_stale() {
        // Fail closed: if we can't tell when the backup ran, say so.
        assert!(is_stale("", 86_400));
        assert!(is_stale("garbage", 86_400));
    }

    #[test]
    fn staleness_allows_half_an_interval_of_slack() {
        let now = crate::sample::host::unix_now();
        let daily = 86_400;

        assert!(!is_stale(&format_rfc3339(now - 3_600), daily), "an hour old is fine");
        assert!(!is_stale(&format_rfc3339(now - 100_000), daily), "27h is within 1.5x");
        assert!(is_stale(&format_rfc3339(now - 200_000), daily), "55h means it stopped");
    }

    #[test]
    fn a_missing_status_file_reports_stale_rather_than_healthy() {
        let provider = BackupsProvider::new(BackupsConfig {
            status_file: "/nonexistent/restic-status.json".into(),
            ..Default::default()
        });
        let status = provider.missing();
        assert!(status.stale);
        assert_eq!(status.snapshot_count, 0);
    }

    #[test]
    fn parses_a_status_file_and_never_echoes_secrets() {
        let dir = std::env::temp_dir().join(format!("cosmos-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("restic-status.json");

        let now = format_rfc3339(crate::sample::host::unix_now());
        std::fs::write(
            &path,
            format!(
                r#"{{
                    "generated_at": "{now}",
                    "last_run": "{now}",
                    "next_run": "2030-01-01T03:00:00Z",
                    "last_exit_code": 0,
                    "duration_secs": 412,
                    "repo_size_bytes": 12345678,
                    "retention": {{ "daily": 7, "weekly": 4, "monthly": 6 }},
                    "state_copy": {{ "ok": true, "at": "{now}", "message": null }},
                    "space_check": {{ "ok": false, "at": "{now}", "message": "12G free, need 50G" }},
                    "snapshots": [
                        {{
                            "id": "abcdef0123456789",
                            "short_id": "abcdef01",
                            "time": "{now}",
                            "hostname": "jupiter",
                            "tags": ["nightly"],
                            "paths": ["/srv/storage"],
                            "size_bytes": 999
                        }}
                    ]
                }}"#
            )
        ).unwrap();

        let mut provider = BackupsProvider::new(BackupsConfig {
            enabled: true,
            status_file: path,
            expected_interval_secs: 86_400,
            repo_label: "jupiter/restic".into(),
            timer_stamp: None,
        });

        let status = provider.build();
        assert!(!status.stale);
        assert_eq!(status.snapshot_count, 1);
        assert_eq!(status.repo_label, "jupiter/restic");
        assert_eq!(status.retention.as_ref().unwrap().daily, 7);
        assert_eq!(status.last_exit_code, Some(0));
        assert!(status.state_copy.as_ref().unwrap().ok);
        let space = status.space_check.as_ref().unwrap();
        assert!(!space.ok);
        assert_eq!(space.message.as_deref(), Some("12G free, need 50G"));

        let snap = provider.poll(false).expect("first poll always produces a snapshot");

        // The wire format must not carry the repository path or password —
        // the struct has nowhere to put them, and this guards that.
        let lower = snap.json.to_lowercase();
        assert!(!lower.contains("password"));
        assert!(!lower.contains("/srv/backups"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
