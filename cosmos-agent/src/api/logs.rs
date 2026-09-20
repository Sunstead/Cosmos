//! Container logs: a REST tail and a WebSocket follow.
//!
//! WebSocket rather than SSE for the follow case, for three reasons that have
//! nothing to do with auth headers (`?token=` handles those for both):
//!
//! 1. Docker log frames contain arbitrary bytes including embedded newlines.
//!    SSE would require splitting every newline into its own `data:` line and
//!    reassembling client-side; a WS frame carries the line as-is.
//! 2. `EventSource` reconnects automatically and unconditionally. Against a
//!    crash-looping container that means silently re-opening a follow stream
//!    on the Docker socket forever, with no backoff the client controls.
//! 3. Browsers cap ~6 concurrent HTTP/1.1 connections per origin. Host SSE +
//!    container SSE + three open log panes already reaches it.

use crate::{ docker::DockerHandle, error::{ from_docker, AgentError }, state::AppState };
use axum::{
    extract::{
        ws::{ Message, WebSocket, WebSocketUpgrade },
        Path,
        Query,
        State,
    },
    response::Response,
    Json,
};
use bollard::container::LogOutput;
use cosmos_common::types::{ LogFrame, LogLine, LogStream, LogsResponse };
use futures_util::StreamExt;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct LogQuery {
    #[serde(default = "default_tail")]
    tail: u32,
    /// Unix seconds; 0 means "from the beginning of what Docker retains".
    #[serde(default)]
    since: i64,
}

fn default_tail() -> u32 {
    500
}

/// Cap on lines buffered toward a websocket client before we start dropping.
/// A container writing faster than the socket drains must never grow the
/// agent's memory without bound.
const WS_BUFFER: usize = 1024;

/// Hard cap on a single REST tail so a pathological `tail` can't be used to
/// pull a gigabyte through the agent.
const MAX_TAIL: u32 = 10_000;

pub async fn tail(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<LogQuery>
) -> Result<Json<LogsResponse>, AgentError> {
    if !state.cfg.docker.allow_logs {
        return Err(AgentError::NotEnabled("container logs"));
    }
    let docker = state.docker.require()?;
    let tail = q.tail.min(MAX_TAIL);

    let mut stream = docker.logs(
        &id,
        Some(DockerHandle::logs_options(tail.to_string(), q.since, false))
    );

    let mut lines = Vec::with_capacity(tail as usize);
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(output) => lines.extend(parse_output(&output)),
            Err(e) => {
                return Err(from_docker("logs", &id, e));
            }
        }
    }

    Ok(Json(LogsResponse { id, lines }))
}

pub async fn follow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<LogQuery>,
    ws: WebSocketUpgrade
) -> Result<Response, AgentError> {
    if !state.cfg.docker.allow_logs {
        return Err(AgentError::NotEnabled("container logs"));
    }
    // Fail with a clean 404 before the upgrade, rather than handing the
    // client a websocket that immediately closes.
    state.docker.assert_exists(&id).await?;

    Ok(ws.on_upgrade(move |socket| pump(socket, state, id, q)))
}

async fn pump(mut socket: WebSocket, state: AppState, id: String, q: LogQuery) {
    let Some(docker) = state.docker.client() else {
        let _ = send_frame(
            &mut socket,
            &(LogFrame::Closed { reason: "docker unavailable".into() })
        ).await;
        return;
    };

    let mut logs = docker.logs(
        &id,
        Some(DockerHandle::logs_options(q.tail.min(MAX_TAIL).to_string(), q.since, true))
    );

    let mut dropped: u32 = 0;
    let mut pending: usize = 0;

    loop {
        tokio::select! {
            // Client-initiated close, or a ping we answer implicitly.
            incoming = socket.recv() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => continue,
                }
            }

            chunk = logs.next() => {
                let Some(chunk) = chunk else {
                    let _ = send_frame(
                        &mut socket,
                        &LogFrame::Closed { reason: "stream ended".into() },
                    ).await;
                    break;
                };

                let Ok(output) = chunk else {
                    let _ = send_frame(
                        &mut socket,
                        &LogFrame::Closed { reason: "log stream error".into() },
                    ).await;
                    break;
                };

                for line in parse_output(&output) {
                    // Crude backpressure: the socket send is awaited, so a
                    // slow client naturally slows the read side. What we
                    // guard against here is an unbounded burst.
                    if pending >= WS_BUFFER {
                        dropped = dropped.saturating_add(1);
                        continue;
                    }
                    pending += 1;
                    if send_frame(&mut socket, &LogFrame::Line(line)).await.is_err() {
                        return;
                    }
                    pending -= 1;
                }

                if dropped > 0 {
                    let _ = send_frame(&mut socket, &LogFrame::Truncated { dropped }).await;
                    dropped = 0;
                }
            }
        }
    }

    let _ = socket.close().await;
}

async fn send_frame(socket: &mut WebSocket, frame: &LogFrame) -> Result<(), axum::Error> {
    let text = serde_json::to_string(frame).unwrap_or_else(|_| "{}".into());
    socket.send(Message::Text(text)).await
}

/// Splits a Docker log chunk into lines.
///
/// A single chunk can contain several newline-separated lines, and with
/// `timestamps: true` each is prefixed with an RFC3339 stamp and a space.
fn parse_output(output: &LogOutput) -> Vec<LogLine> {
    let (stream, bytes) = match output {
        LogOutput::StdErr { message } => (LogStream::Stderr, message),
        LogOutput::StdOut { message } | LogOutput::Console { message } =>
            (LogStream::Stdout, message),
        // Stdin echo is not something a log viewer wants.
        LogOutput::StdIn { .. } => {
            return Vec::new();
        }
    };

    String::from_utf8_lossy(bytes)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let (ts, text) = split_timestamp(line);
            LogLine { stream, ts, text }
        })
        .collect()
}

/// Peels off Docker's leading RFC3339 timestamp when present.
///
/// Detected structurally rather than by parsing a date: a leading token that
/// is date-shaped and followed by a space. A log line that merely starts with
/// a number is left alone.
fn split_timestamp(line: &str) -> (Option<String>, String) {
    if let Some((head, rest)) = line.split_once(' ') {
        let b = head.as_bytes();
        let date_shaped =
            b.len() >= 20 &&
            b[4] == b'-' &&
            b[7] == b'-' &&
            b[10] == b'T' &&
            b[..4].iter().all(u8::is_ascii_digit);

        if date_shaped {
            return (Some(head.to_string()), rest.to_string());
        }
    }
    (None, line.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    // axum re-exports `bytes::Bytes`, so the test needs no extra dependency.
    use axum::body::Bytes;

    fn stdout(s: &str) -> LogOutput {
        LogOutput::StdOut { message: Bytes::from(s.to_string()) }
    }

    #[test]
    fn splits_a_multi_line_chunk() {
        let lines = parse_output(&stdout("first\nsecond\nthird\n"));
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].text, "first");
        assert_eq!(lines[2].text, "third");
        assert!(lines.iter().all(|l| l.stream == LogStream::Stdout));
    }

    #[test]
    fn extracts_docker_timestamps() {
        let lines = parse_output(&stdout("2024-03-01T12:00:00.123456789Z hello world\n"));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].ts.as_deref(), Some("2024-03-01T12:00:00.123456789Z"));
        assert_eq!(lines[0].text, "hello world");
    }

    #[test]
    fn leaves_lines_without_a_timestamp_intact() {
        let lines = parse_output(&stdout("plain message here\n"));
        assert_eq!(lines[0].ts, None);
        assert_eq!(lines[0].text, "plain message here");
    }

    #[test]
    fn does_not_mistake_a_leading_number_for_a_timestamp() {
        // Regression guard: naive "split on first space" would eat the 200.
        let lines = parse_output(&stdout("200 OK from upstream\n"));
        assert_eq!(lines[0].ts, None);
        assert_eq!(lines[0].text, "200 OK from upstream");
    }

    #[test]
    fn stderr_is_labelled_distinctly() {
        let out = LogOutput::StdErr { message: Bytes::from_static(b"boom\n") };
        assert_eq!(parse_output(&out)[0].stream, LogStream::Stderr);
    }

    #[test]
    fn invalid_utf8_is_replaced_rather_than_dropped() {
        let out = LogOutput::StdOut { message: Bytes::from_static(b"ok \xff\xfe bad\n") };
        let lines = parse_output(&out);
        assert_eq!(lines.len(), 1, "a binary blob must not kill the stream");
        assert!(lines[0].text.contains("ok"));
    }

    #[test]
    fn blank_lines_are_skipped() {
        assert!(parse_output(&stdout("\n\n\n")).is_empty());
    }
}
