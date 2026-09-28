//! One signal for "the agent is stopping".
//!
//! axum's graceful shutdown waits for every response to finish, and a host
//! stream or a log socket never does on its own. Without this, one open app
//! kept the agent alive until Docker's SIGKILL, so the clean stop was never
//! recorded and every deploy read as a crash. Long-lived responses end when
//! this fires; the app reconnects to the new agent.

use tokio::sync::watch;

/// Fires the signal. Dropping it fires it too.
pub struct Trigger(watch::Sender<bool>);

/// Waits for the signal. Cheap to clone.
#[derive(Clone)]
pub struct Shutdown(watch::Receiver<bool>);

pub fn channel() -> (Trigger, Shutdown) {
    let (tx, rx) = watch::channel(false);
    (Trigger(tx), Shutdown(rx))
}

impl Trigger {
    pub fn fire(&self) {
        let _ = self.0.send(true);
    }
}

impl Shutdown {
    /// Resolves once shutdown has begun, at once if it already has.
    pub async fn wait(mut self) {
        // An error means the trigger is gone, which is a shutdown too.
        let _ = self.0.wait_for(|&stopping| stopping).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    async fn resolves(s: Shutdown) -> bool {
        tokio::time::timeout(Duration::from_millis(50), s.wait()).await.is_ok()
    }

    #[tokio::test]
    async fn waits_until_fired_and_after() {
        let (trigger, shutdown) = channel();
        assert!(!resolves(shutdown.clone()).await);
        trigger.fire();
        assert!(resolves(shutdown.clone()).await);
        assert!(resolves(shutdown).await, "a late waiter sees it too");
    }

    #[tokio::test]
    async fn a_dropped_trigger_counts() {
        let (trigger, shutdown) = channel();
        drop(trigger);
        assert!(resolves(shutdown).await);
    }
}
