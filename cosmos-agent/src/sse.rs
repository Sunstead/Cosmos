//! Turns a `watch` channel into a Server-Sent Events stream.
//!
//! `WatchStream` yields the current value immediately and then every change,
//! coalescing anything a slow client missed — which is exactly the semantics
//! you want for metrics. Nobody benefits from receiving five one-second-old
//! CPU readings after a stall. The stream ends when the agent starts shutting
//! down, so graceful shutdown can finish.

use crate::shutdown::Shutdown;
use axum::response::sse::{ Event, KeepAlive, Sse };
use futures_util::{ Stream, StreamExt };
use std::{ convert::Infallible, sync::Arc, time::Duration };
use tokio::sync::watch;
use tokio_stream::wrappers::WatchStream;

/// `json` pulls the pre-serialized payload off a snapshot. Serialization
/// happened once in the sampler, so fanning out to N clients costs N string
/// copies rather than N serde passes.
pub fn stream_watch<T, F>(
    rx: watch::Receiver<Arc<T>>,
    json: F,
    shutdown: Shutdown
) -> Sse<impl Stream<Item = Result<Event, Infallible>>>
    where T: Send + Sync + 'static, F: Fn(&T) -> Arc<str> + Send + Clone + 'static
{
    // Deliberately unnamed, so it arrives as the default `message` event.
    // A named event (`event: sample`) is only delivered to a matching
    // `addEventListener`, never to `EventSource.onmessage` — which silently
    // produces an open stream that no default handler ever sees.
    let stream = WatchStream::new(rx)
        .map(move |value| { Ok(Event::default().data(json(&value).as_ref())) })
        .take_until(shutdown.wait());

    Sse::new(stream).keep_alive(
        KeepAlive::new().interval(Duration::from_secs(15)).text("hb")
    )
}
