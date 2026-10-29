//! Running one check: an HTTP GET or a TCP connect.

use super::cert::{ self, CertValidity };
use cosmos_common::types::CheckKind;
use reqwest::dns::{ Addrs, Name, Resolve, Resolving };
use std::{ net::{ IpAddr, Ipv4Addr, SocketAddr }, sync::Arc, time::{ Duration, Instant } };

pub const TIMEOUT: Duration = Duration::from_secs(10);
const LOCAL: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    pub latency_ms: Option<u32>,
    /// Why it failed, or the status when any response counts.
    pub detail: Option<String>,
    pub cert: Option<CertValidity>,
}

impl Outcome {
    fn failed(detail: impl Into<String>) -> Self {
        Self { ok: false, latency_ms: None, detail: Some(detail.into()), cert: None }
    }
}

/// Whether `host` is one of `domains` or under one.
pub fn is_local(domains: &[String], host: &str) -> bool {
    let host = host.trim_end_matches('.');
    domains.iter().any(|d| {
        let d = d.trim_matches('.');
        host.eq_ignore_ascii_case(d) ||
            (host.len() > d.len() &&
                host[host.len() - d.len()..].eq_ignore_ascii_case(d) &&
                host.as_bytes()[host.len() - d.len() - 1] == b'.')
    })
}

/// DNS, except that local domains go to this host.
struct Resolver {
    local: Arc<[String]>,
}

impl Resolve for Resolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let local = is_local(&self.local, &host);
        Box::pin(async move {
            if local {
                // The connector puts the URL's port on each address.
                return Ok(Box::new(std::iter::once(SocketAddr::new(LOCAL, 0))) as Addrs);
            }
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

#[derive(Clone)]
pub struct Prober {
    client: reqwest::Client,
    local: Arc<[String]>,
}

impl Prober {
    pub fn new(local_domains: &[String]) -> Self {
        let local: Arc<[String]> = local_domains.into();
        let client = reqwest::Client
            ::builder()
            .timeout(TIMEOUT)
            .user_agent(concat!("cosmos-agent/", env!("CARGO_PKG_VERSION"), " (uptime check)"))
            // A forward-auth redirect to the sign-in page is the app answering.
            .redirect(reqwest::redirect::Policy::none())
            .tls_info(true)
            .dns_resolver(Arc::new(Resolver { local: local.clone() }))
            .build()
            .expect("reqwest client");
        Self { client, local }
    }

    pub async fn run(&self, kind: CheckKind, target: &str, any_status: bool) -> Outcome {
        match kind {
            CheckKind::Http => self.http(target, any_status).await,
            CheckKind::Tcp => self.tcp(target).await,
        }
    }

    async fn http(&self, url: &str, any_status: bool) -> Outcome {
        let started = Instant::now();
        let res = match self.client.get(url).send().await {
            Ok(res) => res,
            Err(e) => {
                return Outcome::failed(describe(&e));
            }
        };
        let latency_ms = Some(millis(started.elapsed()));
        let cert = res
            .extensions()
            .get::<reqwest::tls::TlsInfo>()
            .and_then(|t| t.peer_certificate())
            .and_then(cert::validity);
        let status = res.status().as_u16();
        let ok = any_status || status < 400;
        let detail = (!ok || any_status).then(|| format!("HTTP {status}"));
        Outcome { ok, latency_ms, detail, cert }
    }

    async fn tcp(&self, target: &str) -> Outcome {
        let Some((host, port)) = split_host_port(target) else {
            return Outcome::failed("not a host:port");
        };
        let started = Instant::now();
        let connect = async {
            if is_local(&self.local, host) {
                tokio::net::TcpStream::connect((LOCAL, port)).await
            } else {
                tokio::net::TcpStream::connect((host, port)).await
            }
        };
        match tokio::time::timeout(TIMEOUT, connect).await {
            Ok(Ok(_)) =>
                Outcome { ok: true, latency_ms: Some(millis(started.elapsed())), detail: None, cert: None },
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionRefused => Outcome::failed("connection refused"),
            Ok(Err(e)) => Outcome::failed(format!("couldn't connect: {e}")),
            Err(_) => Outcome::failed("timed out"),
        }
    }
}

/// `host:port`, with `[v6]:port` too.
pub fn split_host_port(target: &str) -> Option<(&str, u16)> {
    let (host, port) = target.trim().rsplit_once(':')?;
    let host = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    let port: u16 = port.parse().ok()?;
    (!host.is_empty() && !host.contains(char::is_whitespace) && port != 0).then_some((host, port))
}

fn millis(d: Duration) -> u32 {
    d.as_millis().min(u128::from(u32::MAX)) as u32
}

/// "couldn't connect: invalid peer certificate: Expired". The innermost
/// cause is the useful part; reqwest's own message is only the URL.
fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "timed out".into();
    }
    let mut cause: &dyn std::error::Error = e;
    while let Some(next) = cause.source() {
        cause = next;
    }
    if e.is_connect() {
        format!("couldn't connect: {cause}")
    } else {
        cause.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{ AsyncReadExt, AsyncWriteExt };

    /// Answers every connection with `status` and closes it.
    async fn server(status: u16) -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nlocation: https://auth.example.net/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                );
                let _ = sock.write_all(reply.as_bytes()).await;
            }
        });
        port
    }

    #[tokio::test]
    async fn statuses_below_400_are_up_and_redirects_are_not_followed() {
        let p = Prober::new(&[]);
        let up = p.run(CheckKind::Http, &format!("http://127.0.0.1:{}/", server(302).await), false).await;
        assert!(up.ok, "{up:?}");
        assert!(up.latency_ms.is_some());
        assert_eq!(up.detail, None);

        let down = p.run(CheckKind::Http, &format!("http://127.0.0.1:{}/", server(502).await), false).await;
        assert!(!down.ok);
        assert_eq!(down.detail.as_deref(), Some("HTTP 502"));

        let any = p.run(CheckKind::Http, &format!("http://127.0.0.1:{}/", server(401).await), true).await;
        assert!(any.ok);
        assert_eq!(any.detail.as_deref(), Some("HTTP 401"));
    }

    #[tokio::test]
    async fn local_domains_go_to_this_host() {
        let port = server(200).await;
        let p = Prober::new(&["jupiter.invalid".to_string()]);
        let r = p.run(CheckKind::Http, &format!("http://immich.jupiter.invalid:{port}/"), false).await;
        assert!(r.ok, "{r:?}");
        let r = p.run(CheckKind::Tcp, &format!("ntfy.jupiter.invalid:{port}"), false).await;
        assert!(r.ok, "{r:?}");
    }

    #[tokio::test]
    async fn a_refusal_is_down() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let p = Prober::new(&[]);
        let tcp = p.run(CheckKind::Tcp, &format!("127.0.0.1:{port}"), false).await;
        assert_eq!(tcp.detail.as_deref(), Some("connection refused"));
        let http = p.run(CheckKind::Http, &format!("http://127.0.0.1:{port}/"), false).await;
        assert!(!http.ok);
        assert!(http.detail.unwrap().starts_with("couldn't connect"));
    }

    #[test]
    fn matches_domains_and_splits_targets() {
        let d = ["jupiter.example.net".to_string()];
        assert!(is_local(&d, "jupiter.example.net"));
        assert!(is_local(&d, "Immich.Jupiter.example.net."));
        assert!(!is_local(&d, "notjupiter.example.net"));
        assert!(!is_local(&d, "example.net"));
        assert_eq!(split_host_port("192.168.1.1:443"), Some(("192.168.1.1", 443)));
        assert_eq!(split_host_port("[fd00::1]:22"), Some(("fd00::1", 22)));
        assert_eq!(split_host_port("router"), None);
        assert_eq!(split_host_port(":80"), None);
        assert_eq!(split_host_port("router:0"), None);
    }
}
