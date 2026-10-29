//! When a peer counts as up, late or down. Pure: callers pass the time.
//!
//! A peer is heard from by heartbeats, whichever side sends them. It's late
//! once one is overdue and down a little after that, which opens
//! `peer:<name>:unreachable`; two heartbeats in a row bring it back. A peer
//! that said it was stopping (a deploy, a reboot) gets longer.

use cosmos_common::types::PeerState;

/// The dialling side sends one this often.
pub const INTERVAL_SECS: i64 = 15;
/// Two heartbeats missed.
pub const LATE_AFTER: i64 = 30;
/// Four missed: long enough that a blip or a quick restart doesn't page.
pub const DOWN_AFTER: i64 = 60;
/// After a heartbeat saying it's stopping: a reboot or a slow deploy.
pub const STOPPING_GRACE: i64 = 5 * 60;
/// In a row, to come back from down: one heartbeat could be a flap.
pub const UP_AFTER: u32 = 2;

/// What changed, for the caller to report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    WentDown,
    CameBack,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tracker {
    pub state: PeerState,
    /// Unix seconds of the last heartbeat, either way.
    pub last_seen: Option<i64>,
    /// Since when it's been up, for holding back alerts that it explains.
    pub up_since: Option<i64>,
    pub stopping: bool,
    /// Heartbeats in a row since it was last down.
    streak: u32,
    /// When this agent started tracking it: a peer never heard from is
    /// given the same time as one that just went quiet.
    started_at: i64,
}

impl Tracker {
    pub fn new(now: i64) -> Self {
        Self { state: PeerState::Unknown, last_seen: None, up_since: None, stopping: false, streak: 0, started_at: now }
    }

    /// A heartbeat, sent or received.
    pub fn heard(&mut self, now: i64, stopping: bool) -> Option<Change> {
        self.last_seen = Some(now);
        self.stopping = stopping;
        self.streak += 1;
        match self.state {
            PeerState::Down if self.streak < UP_AFTER => None,
            PeerState::Down => {
                self.state = PeerState::Up;
                self.up_since = Some(now);
                Some(Change::CameBack)
            }
            PeerState::Up => None,
            PeerState::Unknown | PeerState::Late => {
                self.state = PeerState::Up;
                self.up_since.get_or_insert(now);
                None
            }
        }
    }

    /// A heartbeat this agent sent that got no answer. Only breaks a streak
    /// back from down; the clock decides the rest.
    pub fn missed(&mut self) {
        self.streak = 0;
    }

    /// Moves to late or down as time passes without a heartbeat.
    pub fn tick(&mut self, now: i64) -> Option<Change> {
        let quiet = now - self.last_seen.unwrap_or(self.started_at);
        let down_after = if self.stopping { STOPPING_GRACE } else { DOWN_AFTER };
        match self.state {
            PeerState::Down => None,
            _ if quiet >= down_after => {
                self.state = PeerState::Down;
                self.up_since = None;
                self.streak = 0;
                Some(Change::WentDown)
            }
            PeerState::Up if quiet >= LATE_AFTER => {
                self.state = PeerState::Late;
                None
            }
            _ => None,
        }
    }

    /// Whether problems that go through this peer should wait: it's not up,
    /// or it came back too recently for those problems to have cleared.
    pub fn explains_failures(&self, now: i64, settle: i64) -> bool {
        self.state != PeerState::Up || self.up_since.is_none_or(|t| now - t < settle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_peer_never_heard_from_goes_down_after_the_same_wait() {
        let mut t = Tracker::new(100);
        assert_eq!(t.tick(100 + DOWN_AFTER - 1), None);
        assert_eq!(t.state, PeerState::Unknown);
        assert_eq!(t.tick(100 + DOWN_AFTER), Some(Change::WentDown));
        assert_eq!(t.state, PeerState::Down);
    }

    #[test]
    fn late_then_down_then_back_after_two_heartbeats() {
        let mut t = Tracker::new(0);
        assert_eq!(t.heard(0, false), None);
        assert_eq!(t.state, PeerState::Up);
        assert_eq!(t.tick(LATE_AFTER), None);
        assert_eq!(t.state, PeerState::Late);
        assert_eq!(t.tick(DOWN_AFTER), Some(Change::WentDown));
        assert_eq!(t.tick(DOWN_AFTER + 100), None, "reports going down once");

        assert_eq!(t.heard(200, false), None, "one heartbeat could be a flap");
        assert_eq!(t.state, PeerState::Down);
        assert_eq!(t.heard(215, false), Some(Change::CameBack));
        assert_eq!(t.state, PeerState::Up);
        assert_eq!(t.up_since, Some(215));
    }

    #[test]
    fn a_missed_heartbeat_breaks_the_way_back() {
        let mut t = Tracker::new(0);
        t.tick(DOWN_AFTER);
        t.heard(100, false);
        t.missed();
        assert_eq!(t.heard(130, false), None);
        assert_eq!(t.heard(145, false), Some(Change::CameBack));
    }

    #[test]
    fn a_late_peer_that_answers_is_simply_up() {
        let mut t = Tracker::new(0);
        t.heard(0, false);
        t.tick(LATE_AFTER);
        assert_eq!(t.heard(LATE_AFTER + 1, false), None);
        assert_eq!(t.state, PeerState::Up);
        assert_eq!(t.up_since, Some(0), "it never went down");
    }

    #[test]
    fn a_peer_that_said_it_was_stopping_gets_longer() {
        let mut t = Tracker::new(0);
        t.heard(0, true);
        assert_eq!(t.tick(DOWN_AFTER * 2), None);
        assert_eq!(t.state, PeerState::Late);
        assert_eq!(t.tick(STOPPING_GRACE), Some(Change::WentDown));
    }

    #[test]
    fn failures_wait_until_the_peer_has_been_back_a_while() {
        let mut t = Tracker::new(0);
        assert!(t.explains_failures(0, 300), "not heard from yet");
        t.heard(0, false);
        assert!(t.explains_failures(10, 300), "only just up");
        assert!(!t.explains_failures(300, 300));
        t.tick(DOWN_AFTER + 300);
        assert!(t.explains_failures(DOWN_AFTER + 300, 300));
    }
}
