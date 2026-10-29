//! Tag lists from container registries, anonymously.
//!
//! One flow for every registry: ask, and on a 401 read the `WWW-Authenticate`
//! challenge, fetch an anonymous pull token from its realm, and ask again.
//! Docker Hub, ghcr.io and any other v2 registry work the same way.
//!
//! Only `tags/list` is ever requested. Docker Hub counts manifest requests
//! against a small anonymous pull limit that deploys need; tag lists are
//! free.

use super::image::ImageRef;
use std::{ collections::HashMap, time::{ Duration, Instant } };

/// Immich's repository has about 30,000 tags (a page per 1,000).
const MAX_PAGES: usize = 50;
const PAGE: usize = 1_000;

pub struct Registry {
    client: reqwest::Client,
    scheme: &'static str,
    /// Anonymous tokens by (registry, path), until they expire.
    tokens: HashMap<(String, String), (String, Instant)>,
}

/// `Bearer realm="…",service="…",scope="…"`.
fn challenge(header: &str) -> Option<HashMap<String, String>> {
    let rest = header.trim().strip_prefix("Bearer ").or_else(|| header.trim().strip_prefix("bearer "))?;
    let mut out = HashMap::new();
    let mut s = rest;
    while let Some(eq) = s.find('=') {
        let key = s[..eq].trim().trim_start_matches(',').trim().to_ascii_lowercase();
        let after = &s[eq + 1..];
        let (value, next) = match after.strip_prefix('"') {
            Some(q) => {
                let end = q.find('"')?;
                (&q[..end], &q[end + 1..])
            }
            None => {
                let end = after.find(',').unwrap_or(after.len());
                (&after[..end], &after[end..])
            }
        };
        out.insert(key, value.to_string());
        s = next;
    }
    out.contains_key("realm").then_some(out)
}

/// The next page from a `Link: </v2/…?last=x&n=1000>; rel="next"` header.
fn next_page(link: Option<&str>) -> Option<String> {
    let link = link?;
    if !link.contains("rel=\"next\"") && !link.contains("rel=next") {
        return None;
    }
    let start = link.find('<')? + 1;
    let end = link[start..].find('>')? + start;
    Some(link[start..end].to_string())
}

impl Registry {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client, scheme: "https", tokens: HashMap::new() }
    }

    #[cfg(test)]
    fn plain_http(client: reqwest::Client) -> Self {
        Self { client, scheme: "http", tokens: HashMap::new() }
    }

    async fn token(&mut self, image: &ImageRef, header: &str) -> Result<String, String> {
        let c = challenge(header).ok_or_else(|| format!("{} asked for sign-in this can't do", image.registry))?;
        let mut req = self.client.get(&c["realm"]);
        let scope = c.get("scope").cloned().unwrap_or_else(|| format!("repository:{}:pull", image.path));
        let mut query = vec![("scope", scope)];
        if let Some(service) = c.get("service") {
            query.push(("service", service.clone()));
        }
        req = req.query(&query);
        let res = req.send().await.map_err(|e| format!("{}: {e}", image.registry))?;
        if !res.status().is_success() {
            return Err(format!("{} refused an anonymous token (HTTP {})", image.registry, res.status().as_u16()));
        }
        let body: serde_json::Value = res.json().await.map_err(|e| format!("{}: {e}", image.registry))?;
        let token = body["token"]
            .as_str()
            .or_else(|| body["access_token"].as_str())
            .ok_or_else(|| format!("{} sent no token", image.registry))?
            .to_string();
        // Short-lived by default; refresh a little early.
        let ttl = body["expires_in"].as_u64().unwrap_or(60).saturating_sub(10).max(10);
        self.tokens.insert(
            (image.registry.clone(), image.path.clone()),
            (token.clone(), Instant::now() + Duration::from_secs(ttl))
        );
        Ok(token)
    }

    async fn get(&mut self, image: &ImageRef, url: &str) -> Result<reqwest::Response, String> {
        let key = (image.registry.clone(), image.path.clone());
        let cached = self.tokens
            .get(&key)
            .filter(|(_, until)| *until > Instant::now())
            .map(|(t, _)| t.clone());
        let send = |token: Option<&str>| {
            let mut req = self.client.get(url);
            if let Some(t) = token {
                req = req.bearer_auth(t);
            }
            req.send()
        };
        let res = send(cached.as_deref()).await.map_err(|e| format!("{}: {e}", image.registry))?;
        if res.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(res);
        }
        let header = res
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|h| h.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let token = self.token(image, &header).await?;
        let mut req = self.client.get(url).bearer_auth(&token);
        req = req.header(reqwest::header::ACCEPT, "application/json");
        req.send().await.map_err(|e| format!("{}: {e}", image.registry))
    }

    /// Every tag in `image`'s repository.
    pub async fn tags(&mut self, image: &ImageRef) -> Result<Vec<String>, String> {
        let origin = format!("{}://{}", self.scheme, image.registry);
        let mut url = format!("{origin}/v2/{}/tags/list?n={PAGE}", image.path);
        let mut tags = Vec::new();
        for _ in 0..MAX_PAGES {
            let res = self.get(image, &url).await?;
            let status = res.status();
            if !status.is_success() {
                return Err(format!("{} answered HTTP {} for {}", image.registry, status.as_u16(), image.repo));
            }
            let next = next_page(res.headers().get(reqwest::header::LINK).and_then(|h| h.to_str().ok()));
            let body: serde_json::Value = res.json().await.map_err(|e| format!("{}: {e}", image.registry))?;
            if let Some(list) = body["tags"].as_array() {
                tags.extend(list.iter().filter_map(|t| t.as_str().map(str::to_string)));
            }
            match next {
                Some(path) if path.starts_with('/') => url = format!("{origin}{path}"),
                Some(full) if full.starts_with(&origin) => url = full,
                _ => {
                    return Ok(tags);
                }
            }
        }
        tracing::warn!(repo = %image.repo, pages = MAX_PAGES, "stopped listing tags at the page limit");
        Ok(tags)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{ Arc, Mutex };
    use tokio::io::{ AsyncReadExt, AsyncWriteExt };

    #[test]
    fn reads_challenges_and_links() {
        let c = challenge(r#"Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/redis:pull""#).unwrap();
        assert_eq!(c["realm"], "https://auth.docker.io/token");
        assert_eq!(c["service"], "registry.docker.io");
        assert_eq!(c["scope"], "repository:library/redis:pull");
        assert!(challenge("Basic realm=\"x\"").is_none());
        assert_eq!(
            next_page(Some(r#"</v2/library/redis/tags/list?last=8.2-alpine&n=1000>; rel="next""#)).as_deref(),
            Some("/v2/library/redis/tags/list?last=8.2-alpine&n=1000")
        );
        assert_eq!(next_page(None), None);
    }

    /// A registry that wants a token, pages its tags, and records every path
    /// it was asked for.
    async fn fake_registry() -> (u16, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let asked = Arc::new(Mutex::new(Vec::new()));
        let log = asked.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("").to_string();
                log.lock().unwrap().push(path.clone());
                let authed = req.to_ascii_lowercase().contains("authorization: bearer good");
                let (status, headers, body) = if path.starts_with("/token") {
                    ("200 OK", String::new(), r#"{"token":"good","expires_in":300}"#.to_string())
                } else if !authed {
                    (
                        "401 Unauthorized",
                        format!("www-authenticate: Bearer realm=\"http://127.0.0.1:{port}/token\",service=\"fake\",scope=\"repository:org/app:pull\"\r\n"),
                        String::new(),
                    )
                } else if path.contains("last=") {
                    ("200 OK", String::new(), r#"{"name":"org/app","tags":["v1.2.0","v1.3.0"]}"#.to_string())
                } else {
                    (
                        "200 OK",
                        "link: </v2/org/app/tags/list?last=v1.1.0&n=1000>; rel=\"next\"\r\n".to_string(),
                        r#"{"name":"org/app","tags":["v1.0.0","v1.1.0"]}"#.to_string(),
                    )
                };
                let reply = format!(
                    "HTTP/1.1 {status}\r\n{headers}content-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(reply.as_bytes()).await;
            }
        });
        (port, asked)
    }

    /// Against Docker Hub and ghcr.io; run with `--ignored`.
    #[tokio::test]
    #[ignore]
    async fn lists_real_registries() {
        let mut reg = Registry::new(reqwest::Client::new());
        for image in ["redis:7.4.11-alpine", "ghcr.io/goauthentik/server:2026.5.2", "binwiederhier/ntfy:v2.28.0"] {
            let image = ImageRef::parse(image).unwrap();
            let tags = reg.tags(&image).await.unwrap();
            assert!(tags.contains(&image.tag), "{} lists its own tag ({} tags)", image.repo, tags.len());
        }
    }

    #[tokio::test]
    async fn gets_a_token_then_follows_every_page() {
        let (port, asked) = fake_registry().await;
        let image = ImageRef::parse(&format!("127.0.0.1:{port}/org/app:v1.0.0")).unwrap();
        let mut reg = Registry::plain_http(reqwest::Client::new());
        let tags = reg.tags(&image).await.unwrap();
        assert_eq!(tags, ["v1.0.0", "v1.1.0", "v1.2.0", "v1.3.0"]);

        // Again: the cached token means no 401 and no token request.
        asked.lock().unwrap().clear();
        reg.tags(&image).await.unwrap();
        let paths = asked.lock().unwrap().clone();
        assert!(paths.iter().all(|p| p.contains("/tags/list")), "only tag lists, never a manifest or a token: {paths:?}");
        assert_eq!(paths.len(), 2);
    }
}
