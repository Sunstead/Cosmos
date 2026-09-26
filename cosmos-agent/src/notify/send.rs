//! Delivering one event to one channel.

use super::Channel;
use cosmos_common::types::{ ChannelKind, Event, ProblemState, Severity };
use serde_json::json;
use std::time::Duration;

const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
/// Waits before the second and third tries.
const RETRY_AFTER: [Duration; 2] = [Duration::from_secs(2), Duration::from_secs(10)];

pub fn client() -> reqwest::Client {
    reqwest::Client
        ::builder()
        .timeout(HTTP_TIMEOUT)
        .user_agent(concat!("cosmos-agent/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("reqwest client")
}

/// What a notification says, whatever carries it.
#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub title: String,
    pub body: String,
    /// ntfy's 1 (min) to 5 (max).
    pub priority: u8,
    /// ntfy tags; ones naming an emoji show as that emoji.
    pub tags: Vec<&'static str>,
    pub click: Option<String>,
}

pub fn message(e: &Event, node: &str, link_url: Option<&str>) -> Message {
    let resolved = matches!(&e.problem, Some(p) if p.state == ProblemState::Resolved);
    let (priority, tag) = match (resolved, e.severity) {
        (true, _) => (2, "white_check_mark"),
        (false, Severity::Error) => (4, "rotating_light"),
        (false, Severity::Warning) => (3, "warning"),
        (false, Severity::Info) => (2, "information_source"),
    };
    Message {
        title: format!("{node}: {}", e.title),
        body: e.detail.clone().unwrap_or_else(|| e.title.clone()),
        priority,
        tags: vec![tag],
        click: link_url.map(str::to_string),
    }
}

fn request(client: &reqwest::Client, ch: &Channel, msg: &Message, e: &Event, node: &str) -> reqwest::RequestBuilder {
    let req = match ch.kind {
        // Publishing as JSON goes to the server root, with the topic in the body.
        ChannelKind::Ntfy => {
            let mut body =
                json!({
                "topic": ch.topic.as_deref().unwrap_or_default(),
                "title": msg.title,
                "message": msg.body,
                "priority": msg.priority,
                "tags": msg.tags,
            });
            if let Some(click) = &msg.click {
                body["click"] = json!(click);
            }
            client.post(ch.url.trim_end_matches('/')).json(&body)
        }
        ChannelKind::Webhook =>
            client.post(&ch.url).json(
                &json!({
                "node": node,
                "title": msg.title,
                "message": msg.body,
                "link": msg.click,
                "event": e,
            })
            ),
    };
    match ch.secret.as_deref().filter(|s| !s.is_empty()) {
        Some(secret) => req.bearer_auth(secret),
        None => req,
    }
}

/// One attempt. The error is short enough to show next to the channel.
async fn attempt(client: &reqwest::Client, ch: &Channel, msg: &Message, e: &Event, node: &str) -> Result<(), String> {
    let res = request(client, ch, msg, e, node)
        .send().await
        .map_err(|err| {
            if err.is_timeout() {
                "timed out".to_string()
            } else if err.is_connect() {
                "couldn't connect".to_string()
            } else {
                err.to_string()
            }
        })?;
    let status = res.status();
    if status.is_success() {
        return Ok(());
    }
    let body = res.text().await.unwrap_or_default();
    let body: String = body.trim().chars().take(200).collect();
    Err(if body.is_empty() { format!("HTTP {status}") } else { format!("HTTP {status}: {body}") })
}

/// One try, for a test from the app: whoever pressed the button wants the
/// answer now, not after the retries.
pub async fn deliver_once(client: &reqwest::Client, ch: &Channel, e: &Event, node: &str, link_url: Option<&str>) -> Result<(), String> {
    attempt(client, ch, &message(e, node, link_url), e, node).await
}

/// Tries up to three times. A 4xx won't get better on its own, so it isn't
/// retried.
pub async fn deliver(client: &reqwest::Client, ch: &Channel, e: &Event, node: &str, link_url: Option<&str>) -> Result<(), String> {
    let msg = message(e, node, link_url);
    let mut result = attempt(client, ch, &msg, e, node).await;
    for wait in RETRY_AFTER {
        match &result {
            Ok(()) => break,
            Err(err) if err.starts_with("HTTP 4") => break,
            Err(_) => {}
        }
        tokio::time::sleep(wait).await;
        result = attempt(client, ch, &msg, e, node).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{ http::{ HeaderMap, StatusCode }, routing::post, Json, Router };
    use cosmos_common::types::{ EventCategory, ProblemRef };
    use std::sync::{ Arc, Mutex };

    type Seen = Arc<Mutex<Vec<(Option<String>, serde_json::Value)>>>;

    /// A receiver on a random port that records each POST's bearer token and
    /// body, and answers with `status`.
    async fn receiver(status: StatusCode) -> (String, Seen) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen: Seen = Arc::default();
        let log = seen.clone();
        let app = Router::new().route(
            "/",
            post(move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
                let log = log.clone();
                async move {
                    let auth = headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    log.lock().unwrap().push((auth, body));
                    (status, "nope")
                }
            })
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, seen)
    }

    fn ntfy(url: &str) -> Channel {
        Channel {
            id: 1,
            name: "phone".into(),
            kind: ChannelKind::Ntfy,
            url: format!("{url}/"),
            topic: Some("cosmos-jupiter".into()),
            secret: Some("tk_test".into()),
            enabled: true,
            min_severity: Severity::Warning,
            recoveries: true,
            categories: vec![],
        }
    }

    fn crash() -> Event {
        Event {
            id: 7,
            at: 0,
            category: EventCategory::Container,
            kind: "crashed".into(),
            severity: Severity::Error,
            subject: "gitea".into(),
            title: "gitea crashed (exit 1)".into(),
            detail: Some("Exited with code 1.".into()),
            actor: None,
            service: Some("gitea".into()),
            problem: None,
        }
    }

    #[test]
    fn messages_rank_by_severity_and_recoveries_are_quiet() {
        let m = message(&crash(), "jupiter", Some("https://cosmos.example.com/events"));
        assert_eq!(m.title, "jupiter: gitea crashed (exit 1)");
        assert_eq!(m.body, "Exited with code 1.");
        assert_eq!((m.priority, m.tags.as_slice()), (4, ["rotating_light"].as_slice()));
        assert_eq!(m.click.as_deref(), Some("https://cosmos.example.com/events"));

        let recovered = Event {
            problem: Some(ProblemRef { key: "k".into(), state: ProblemState::Resolved }),
            detail: None,
            title: "gitea is running again".into(),
            ..crash()
        };
        let m = message(&recovered, "jupiter", None);
        assert_eq!((m.priority, m.tags.as_slice()), (2, ["white_check_mark"].as_slice()));
        assert_eq!(m.body, "gitea is running again", "the title stands in for a missing detail");
    }

    #[tokio::test]
    async fn ntfy_gets_json_at_the_root_with_the_token() {
        let (url, seen) = receiver(StatusCode::OK).await;
        deliver(&client(), &ntfy(&url), &crash(), "jupiter", None).await.unwrap();
        let seen = seen.lock().unwrap();
        let (auth, body) = &seen[0];
        assert_eq!(auth.as_deref(), Some("Bearer tk_test"));
        assert_eq!(body["topic"], "cosmos-jupiter");
        assert_eq!(body["title"], "jupiter: gitea crashed (exit 1)");
        assert_eq!(body["priority"], 4);
        assert_eq!(body["tags"][0], "rotating_light");
        assert!(body.get("click").is_none());
    }

    #[tokio::test]
    async fn a_webhook_gets_the_event() {
        let (url, seen) = receiver(StatusCode::NO_CONTENT).await;
        let hook = Channel { kind: ChannelKind::Webhook, url: format!("{url}/"), topic: None, secret: None, ..ntfy(&url) };
        deliver(&client(), &hook, &crash(), "jupiter", None).await.unwrap();
        let seen = seen.lock().unwrap();
        let (auth, body) = &seen[0];
        assert_eq!(auth, &None);
        assert_eq!(body["node"], "jupiter");
        assert_eq!(body["event"]["kind"], "crashed");
        assert_eq!(body["event"]["id"], 7);
    }

    #[tokio::test]
    async fn a_rejection_is_reported_and_not_retried() {
        let (url, seen) = receiver(StatusCode::FORBIDDEN).await;
        let err = deliver(&client(), &ntfy(&url), &crash(), "jupiter", None).await.unwrap_err();
        assert_eq!(err, "HTTP 403 Forbidden: nope");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn nothing_listening_is_a_connect_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let err = attempt(&client(), &ntfy(&url), &message(&crash(), "jupiter", None), &crash(), "jupiter").await;
        assert_eq!(err, Err("couldn't connect".into()));
    }
}
