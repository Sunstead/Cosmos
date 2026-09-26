//! Starting the infrastructure repository's update workflow, and following
//! the run.
//!
//! The token only needs "Actions: read and write" on that one repository. It
//! can start a workflow and read its runs; it can't read or push code. The
//! workflow checks every input against compose and the registry itself, so a
//! leaked token can at worst ask for a tag the rules already allow.

use crate::backups::parse_rfc3339;
use std::sync::{ atomic::{ AtomicI64, Ordering }, Arc };

/// Never printed: `Debug` shows only whether it's set.
#[derive(Clone, Default)]
pub struct Secret(pub String);

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(if self.0.is_empty() { "Secret(unset)" } else { "Secret(..)" })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunInfo {
    pub id: u64,
    /// queued, in_progress, completed, …
    pub status: String,
    /// success, failure, cancelled, … once completed.
    pub conclusion: Option<String>,
    pub html_url: String,
}

#[derive(Clone)]
pub struct GitHub {
    client: reqwest::Client,
    api: String,
    token: Secret,
    repo: String,
    workflow: String,
    git_ref: String,
    /// From the last response's token-expiry header, unix seconds; 0 unknown.
    expires_at: Arc<AtomicI64>,
}

/// `2027-09-01 00:00:00 UTC`, GitHub's format for a token's expiry.
fn parse_expiry(s: &str) -> Option<i64> {
    let s = s.trim().trim_end_matches("UTC").trim();
    parse_rfc3339(&s.replacen(' ', "T", 1))
}

impl GitHub {
    pub fn new(client: reqwest::Client, token: Secret, repo: &str, workflow: &str, git_ref: &str) -> Self {
        Self::with_api(client, "https://api.github.com", token, repo, workflow, git_ref)
    }

    pub fn with_api(client: reqwest::Client, api: &str, token: Secret, repo: &str, workflow: &str, git_ref: &str) -> Self {
        Self {
            client,
            api: api.trim_end_matches('/').to_string(),
            token,
            repo: repo.to_string(),
            workflow: workflow.to_string(),
            git_ref: git_ref.to_string(),
            expires_at: Arc::new(AtomicI64::new(0)),
        }
    }

    pub fn expires_at(&self) -> Option<i64> {
        Some(self.expires_at.load(Ordering::Relaxed)).filter(|t| *t > 0)
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{}{path}", self.api))
            .bearer_auth(&self.token.0)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<reqwest::Response, String> {
        let res = req.send().await.map_err(|e| format!("couldn't reach GitHub: {e}"))?;
        if let Some(t) = res
            .headers()
            .get("github-authentication-token-expiration")
            .and_then(|h| h.to_str().ok())
            .and_then(parse_expiry)
        {
            self.expires_at.store(t, Ordering::Relaxed);
        }
        Ok(res)
    }

    async fn failure(res: reqwest::Response) -> String {
        let status = res.status().as_u16();
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let message = body["message"].as_str().unwrap_or("").to_string();
        match status {
            401 => "GitHub refused the token (expired or revoked?)".into(),
            403 | 404 => format!("GitHub said HTTP {status}: the token needs Actions read and write on the repository ({message})"),
            _ if message.is_empty() => format!("GitHub said HTTP {status}"),
            _ => format!("GitHub said HTTP {status}: {message}"),
        }
    }

    /// Starts the workflow. Returns the run when GitHub says which it is.
    pub async fn dispatch(&self, inputs: &serde_json::Value) -> Result<Option<RunInfo>, String> {
        let path = format!("/repos/{}/actions/workflows/{}/dispatches", self.repo, self.workflow);
        let body = serde_json::json!({ "ref": self.git_ref, "inputs": inputs, "return_run_details": true });
        let mut res = self.send(self.request(reqwest::Method::POST, &path).json(&body)).await?;
        if res.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            // An API without run details; the run is found by its name instead.
            let plain = serde_json::json!({ "ref": self.git_ref, "inputs": inputs });
            res = self.send(self.request(reqwest::Method::POST, &path).json(&plain)).await?;
        }
        match res.status().as_u16() {
            204 => Ok(None),
            200 | 201 => {
                let v: serde_json::Value = res.json().await.unwrap_or_default();
                Ok(
                    v["workflow_run_id"].as_u64().map(|id| RunInfo {
                        id,
                        status: "queued".into(),
                        conclusion: None,
                        html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
                    })
                )
            }
            _ => Err(Self::failure(res).await),
        }
    }

    fn run_from(v: &serde_json::Value) -> Option<RunInfo> {
        Some(RunInfo {
            id: v["id"].as_u64()?,
            status: v["status"].as_str().unwrap_or_default().to_string(),
            conclusion: v["conclusion"].as_str().map(str::to_string),
            html_url: v["html_url"].as_str().unwrap_or_default().to_string(),
        })
    }

    /// The dispatched run whose name carries `request_id`.
    pub async fn find_run(&self, request_id: &str) -> Result<Option<RunInfo>, String> {
        let path = format!("/repos/{}/actions/workflows/{}/runs?event=workflow_dispatch&per_page=30", self.repo, self.workflow);
        let res = self.send(self.request(reqwest::Method::GET, &path)).await?;
        if !res.status().is_success() {
            return Err(Self::failure(res).await);
        }
        let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Ok(
            v["workflow_runs"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|r| r["display_title"].as_str().is_some_and(|t| t.contains(request_id)))
                .and_then(Self::run_from)
        )
    }

    pub async fn run(&self, id: u64) -> Result<RunInfo, String> {
        let res = self.send(self.request(reqwest::Method::GET, &format!("/repos/{}/actions/runs/{id}", self.repo))).await?;
        if !res.status().is_success() {
            return Err(Self::failure(res).await);
        }
        let v: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        Self::run_from(&v).ok_or_else(|| "GitHub sent a run without an id".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tokio::io::{ AsyncReadExt, AsyncWriteExt };

    #[test]
    fn the_token_never_prints() {
        let s = Secret("github_pat_11ABCDEF".into());
        assert_eq!(format!("{s:?}"), "Secret(..)");
        assert_eq!(parse_expiry("2027-09-01 00:00:00 UTC"), Some(1_819_756_800));
    }

    /// A GitHub that answers dispatches with `dispatch_status` and records
    /// what it was sent.
    async fn fake_github(dispatch_status: u16) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                log.lock().unwrap().push(req.clone());
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                let (status, body) = if path.ends_with("/dispatches") {
                    if dispatch_status == 200 && req.contains("return_run_details") {
                        ("200 OK", r#"{"workflow_run_id":42,"html_url":"https://github.com/o/r/actions/runs/42"}"#)
                    } else {
                        ("204 No Content", "")
                    }
                } else if path.contains("/workflows/update.yml/runs") {
                    ("200 OK", r#"{"workflow_runs":[{"id":7,"display_title":"Update other","status":"completed"},{"id":8,"display_title":"Update ntfy (req-123)","status":"in_progress","conclusion":null,"html_url":"https://github.com/o/r/actions/runs/8"}]}"#)
                } else {
                    ("200 OK", r#"{"id":8,"status":"completed","conclusion":"success","html_url":"https://github.com/o/r/actions/runs/8"}"#)
                };
                let reply = format!(
                    "HTTP/1.1 {status}\r\ngithub-authentication-token-expiration: 2027-09-01 00:00:00 UTC\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(reply.as_bytes()).await;
            }
        });
        (format!("http://127.0.0.1:{port}"), seen)
    }

    fn gh(api: &str) -> GitHub {
        GitHub::with_api(reqwest::Client::new(), api, Secret("tok".into()), "o/r", "update.yml", "main")
    }

    #[tokio::test]
    async fn dispatches_and_follows_the_run() {
        let (api, seen) = fake_github(200).await;
        let gh = gh(&api);
        let run = gh.dispatch(&serde_json::json!({ "request_id": "req-123" })).await.unwrap().unwrap();
        assert_eq!(run.id, 42);
        assert_eq!(gh.expires_at(), Some(1_819_756_800));
        let sent = seen.lock().unwrap()[0].clone();
        assert!(sent.to_ascii_lowercase().contains("authorization: bearer tok"));
        assert!(sent.contains(r#""ref":"main""#) && sent.contains("req-123"));

        let done = gh.run(8).await.unwrap();
        assert_eq!(done.conclusion.as_deref(), Some("success"));
    }

    #[tokio::test]
    async fn finds_the_run_by_name_when_github_does_not_say() {
        let (api, _) = fake_github(204).await;
        let gh = gh(&api);
        assert_eq!(gh.dispatch(&serde_json::json!({})).await.unwrap(), None);
        let run = gh.find_run("req-123").await.unwrap().unwrap();
        assert_eq!((run.id, run.status.as_str()), (8, "in_progress"));
        assert_eq!(gh.find_run("req-999").await.unwrap(), None);
    }
}
