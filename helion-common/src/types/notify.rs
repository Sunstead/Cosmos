use super::{ EventCategory, Severity };
use serde::{ Deserialize, Serialize };
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone, Copy, PartialEq, Eq)]
#[ts(export, export_to = "../../app/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    /// An ntfy server and topic, which the ntfy phone app subscribes to.
    Ntfy,
    /// Any URL that accepts a JSON POST.
    Webhook,
}

impl ChannelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ntfy => "ntfy",
            Self::Webhook => "webhook",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ntfy" => Some(Self::Ntfy),
            "webhook" => Some(Self::Webhook),
            _ => None,
        }
    }
}

/// How deliveries to a channel have gone since the agent started.
#[derive(Serialize, Deserialize, TS, Debug, Clone, Default, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct ChannelStatus {
    #[ts(type = "number | null")]
    pub last_ok_at: Option<i64>,
    #[ts(type = "number | null")]
    pub last_error_at: Option<i64>,
    pub last_error: Option<String>,
}

/// Where notifications go, and which ones. The secret is never sent back:
/// `has_secret` says whether one is saved.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct NotifyChannel {
    pub id: String,
    pub name: String,
    pub kind: ChannelKind,
    /// ntfy: the server, e.g. `https://ntfy.example.com`. Webhook: the URL
    /// posted to.
    pub url: String,
    /// ntfy only.
    pub topic: Option<String>,
    pub has_secret: bool,
    pub enabled: bool,
    /// The least severe event it gets.
    pub min_severity: Severity,
    /// Whether it hears when a problem it was told about clears.
    pub recoveries: bool,
    /// Only events in these; empty means all of them.
    pub categories: Vec<EventCategory>,
    pub status: ChannelStatus,
}

/// Creating or editing a channel.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct NotifyChannelInput {
    pub name: String,
    pub kind: ChannelKind,
    pub url: String,
    #[serde(default)]
    #[ts(optional)]
    pub topic: Option<String>,
    /// The ntfy access token, or a bearer token for a webhook. Leave it out to
    /// keep the saved one; an empty string removes it.
    #[serde(default)]
    #[ts(optional)]
    pub secret: Option<String>,
    pub enabled: bool,
    pub min_severity: Severity,
    pub recoveries: bool,
    #[serde(default)]
    pub categories: Vec<EventCategory>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, Default, PartialEq)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct NotifySettings {
    /// Opened when a notification is tapped, e.g.
    /// `https://cosmos.example.com/events`.
    pub link_url: Option<String>,
}

/// `GET /v1/notify`.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../app/src/generated/")]
pub struct NotifyResponse {
    pub channels: Vec<NotifyChannel>,
    pub settings: NotifySettings,
}
