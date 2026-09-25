use serde::{ Deserialize, Serialize };
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct StepStatus {
    pub ok: bool,
    /// RFC3339.
    pub at: Option<String>,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct RetentionPolicy {
    pub daily: u32,
    pub weekly: u32,
    pub monthly: u32,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct BackupSnapshotInfo {
    pub id: String,
    pub short_id: String,
    /// RFC3339.
    pub time: String,
    pub hostname: String,
    pub tags: Vec<String>,
    pub paths: Vec<String>,
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
}

/// Read-only view of a restic repository, assembled by the backup script on
/// the host and read from a status file by the agent.
///
/// Deliberately absent: the repository path, `RESTIC_PASSWORD`, and the
/// heartbeat push URL (it embeds a token). The agent never holds any of them,
/// so they cannot leak from here.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct BackupsStatus {
    /// RFC3339, written by the script.
    pub generated_at: String,
    /// Agent-computed: `generated_at` older than 1.5x the expected interval.
    ///
    /// The most important field here. A backup system that silently stopped
    /// running looks identical to a healthy one if all you render is a list of
    /// snapshots — they just quietly stop getting newer.
    pub stale: bool,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    /// Independent signal: mtime of the systemd timer stamp file. If this is
    /// newer than `generated_at`, the timer fired but the job died before it
    /// could write its status.
    pub timer_last_fired: Option<String>,
    pub last_exit_code: Option<i32>,
    #[ts(type = "number | null")]
    pub duration_secs: Option<u64>,
    /// A display name from config, never the real path.
    pub repo_label: String,
    #[ts(type = "number | null")]
    pub repo_size_bytes: Option<u64>,
    pub snapshot_count: u32,
    pub snapshots: Vec<BackupSnapshotInfo>,
    pub retention: Option<RetentionPolicy>,
    pub postgres_dump: Option<StepStatus>,
    /// The second copy of the state (dumps, volumes, config) on another disk.
    /// Absent from agents before 0.5, and null when the script doesn't make one.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub state_copy: Option<StepStatus>,
    /// Whether the repository's filesystem had room for tonight's backup; the
    /// message says how much was free. Absent from agents before 0.5.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub space_check: Option<StepStatus>,
    pub heartbeat: Option<StepStatus>,
}
