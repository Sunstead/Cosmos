use serde::{ Deserialize, Serialize };
use ts_rs::TS;

/// How an update is applied. Set per unit in the UI; the rules in compose
/// labels (held majors, one major at a time) still apply either way.
#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum UpdatePolicy {
    /// Offered; applied when someone presses Update.
    #[default]
    Manual,
    /// Patch releases apply on their own after the nightly backup.
    Patch,
    /// Anything the labels allow applies on its own after the nightly backup.
    Auto,
}

impl UpdatePolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Patch => "patch",
            Self::Auto => "auto",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "manual" => Some(Self::Manual),
            "patch" => Some(Self::Patch),
            "auto" => Some(Self::Auto),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Patch,
    Minor,
    Major,
}

/// A newer tag, and when it can apply on its own.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdateCandidate {
    pub tag: String,
    pub change: ChangeKind,
    /// Unix seconds this agent first saw the tag.
    #[ts(type = "number")]
    pub first_seen: i64,
}

/// A newer tag the rules keep back, and why.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct HeldUpdate {
    pub tag: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum UpdateRunKind {
    Update,
    Rollback,
}

impl UpdateRunKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Update => "update",
            Self::Rollback => "rollback",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "update" => Some(Self::Update),
            "rollback" => Some(Self::Rollback),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum UpdateRunState {
    /// Waiting for the run ahead of it.
    Queued,
    /// Asked GitHub to start the workflow.
    Dispatched,
    /// The workflow is backing up, committing and deploying.
    Running,
    /// Deployed; checking the service stays up.
    Watching,
    Done,
    /// The workflow failed or refused; nothing changed, or the deploy did.
    Failed,
    /// Deployed, but the service went down or kept restarting.
    Broken,
}

impl UpdateRunState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Dispatched => "dispatched",
            Self::Running => "running",
            Self::Watching => "watching",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Broken => "broken",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(Self::Queued),
            "dispatched" => Some(Self::Dispatched),
            "running" => Some(Self::Running),
            "watching" => Some(Self::Watching),
            "done" => Some(Self::Done),
            "failed" => Some(Self::Failed),
            "broken" => Some(Self::Broken),
            _ => None,
        }
    }

    pub fn finished(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Broken)
    }
}

/// One update or rollback, from asking to the end of the watch after deploy.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdateRun {
    pub id: String,
    pub unit: String,
    pub kind: UpdateRunKind,
    pub from: String,
    pub to: String,
    /// Who asked, or `auto`.
    pub by: String,
    pub state: UpdateRunState,
    #[ts(type = "number")]
    pub requested_at: i64,
    #[ts(type = "number | null")]
    pub finished_at: Option<i64>,
    /// The workflow run on GitHub.
    pub run_url: Option<String>,
    pub detail: Option<String>,
}

/// What moves together: every service running one image repository, or an
/// explicit `cosmos.update.group` of several.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdateUnit {
    /// `group:<name>`, or the image repository as compose names it.
    pub id: String,
    pub name: String,
    /// Compose services.
    pub services: Vec<String>,
    /// Image repositories, without tags.
    pub images: Vec<String>,
    pub current: String,
    /// The newest tag the rules allow.
    pub available: Option<UpdateCandidate>,
    /// The newest patch, when `available` is bigger; what "patches
    /// automatically" takes.
    pub patch: Option<UpdateCandidate>,
    pub held: Option<HeldUpdate>,
    pub notes_url: Option<String>,
    pub policy: UpdatePolicy,
    /// Auto-updates stop after a broken update, until someone sets the
    /// policy again.
    pub paused: Option<String>,
    /// Services with a database: the state is backed up first, and a
    /// rollback may need that backup restored.
    pub backup: bool,
    /// Why it can't update at all (`cosmos.update: off`, conflicting labels).
    pub blocked: Option<String>,
    /// The latest run, finished or not.
    pub run: Option<UpdateRun>,
    /// The tag a rollback returns to.
    pub previous: Option<String>,
}

/// `GET /v1/updates`.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdatesResponse {
    pub units: Vec<UpdateUnit>,
    /// Unix seconds of the last registry check.
    #[ts(type = "number | null")]
    pub checked_at: Option<i64>,
    /// Registries that couldn't be read at the last check.
    pub errors: Vec<String>,
    /// Whether updates can be applied: a token and a repository are set.
    pub can_apply: bool,
    /// Unix seconds the GitHub token expires, when GitHub says.
    #[ts(type = "number | null")]
    pub token_expires_at: Option<i64>,
    /// Recent runs across units, newest first.
    pub history: Vec<UpdateRun>,
    /// A tag must be this old before it applies on its own.
    pub min_age_days: u32,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdateApplyInput {
    pub unit: String,
    pub tag: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdateUnitInput {
    pub unit: String,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct UpdatePolicyInput {
    pub unit: String,
    pub policy: UpdatePolicy,
}
