//! Which events a channel gets, and the flood guard that keeps a flapping
//! problem or a crash-looping container from ringing the phone every minute.

use super::Channel;
use cosmos_common::types::{ Event, ProblemState };
use std::collections::HashMap;

/// A problem opens at most once per this long per channel, and the same
/// one-off event (the same container crashing) is sent at most once.
pub const FLOOD_WINDOW: i64 = 30 * 60;

pub fn wants(ch: &Channel, e: &Event) -> bool {
    ch.enabled &&
        (ch.categories.is_empty() || ch.categories.contains(&e.category)) &&
        e.severity >= ch.min_severity &&
        (ch.recoveries || !matches!(&e.problem, Some(p) if p.state == ProblemState::Resolved))
}

struct Opening {
    /// When an opening was last sent.
    sent_at: i64,
    /// The last opening was held back; a resolution then says nothing.
    held: bool,
}

/// Per channel. Held-back openings are delivered late, once the window has
/// passed, if the problem is still open: otherwise a problem that flapped
/// and then stuck would look resolved on the phone.
#[derive(Default)]
pub struct FloodGuard {
    openings: HashMap<(i64, String), Opening>,
    /// Held-back openings waiting for the window to pass.
    pending: HashMap<(i64, String), Event>,
    one_offs: HashMap<(i64, String), i64>,
}

impl FloodGuard {
    /// Whether to send `e` to channel `ch` now.
    pub fn allow(&mut self, ch: i64, e: &Event, now: i64) -> bool {
        match &e.problem {
            Some(p) if p.state == ProblemState::Opened => {
                let k = (ch, p.key.clone());
                match self.openings.get_mut(&k) {
                    Some(opening) if now - opening.sent_at < FLOOD_WINDOW => {
                        opening.held = true;
                        self.pending.insert(k, e.clone());
                        false
                    }
                    _ => {
                        self.openings.insert(k, Opening { sent_at: now, held: false });
                        true
                    }
                }
            }
            Some(p) => {
                let k = (ch, p.key.clone());
                // Cleared before anyone heard it reopened: nothing to say.
                if self.pending.remove(&k).is_some() {
                    return false;
                }
                // No record at all is an opening sent before the agent
                // restarted, which still deserves its recovery.
                !self.openings.get(&k).is_some_and(|o| o.held)
            }
            None => {
                let k = (ch, format!("{}:{}:{}", e.category.as_str(), e.subject, e.kind));
                match self.one_offs.get(&k) {
                    Some(at) if now - at < FLOOD_WINDOW => false,
                    _ => {
                        self.one_offs.insert(k, now);
                        true
                    }
                }
            }
        }
    }

    /// Held-back openings whose window has passed and whose problem is still
    /// open, now due, as (channel, event).
    pub fn due(&mut self, now: i64, still_open: impl Fn(&str) -> bool) -> Vec<(i64, Event)> {
        let ready: Vec<(i64, String)> = self.pending
            .keys()
            .filter(|k| self.openings.get(*k).is_none_or(|o| now - o.sent_at >= FLOOD_WINDOW))
            .cloned()
            .collect();
        let mut out = Vec::new();
        for k in ready {
            let Some(event) = self.pending.remove(&k) else {
                continue;
            };
            if still_open(&k.1) {
                self.openings.insert(k.clone(), Opening { sent_at: now, held: false });
                out.push((k.0, event));
            }
        }
        // Forget one-offs and openings well past their window.
        self.one_offs.retain(|_, at| now - *at < FLOOD_WINDOW);
        self.openings.retain(|k, o| self.pending.contains_key(k) || now - o.sent_at < 2 * FLOOD_WINDOW);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmos_common::types::{ ChannelKind, EventCategory, ProblemRef, Severity };

    fn channel() -> Channel {
        Channel {
            id: 1,
            name: "phone".into(),
            kind: ChannelKind::Ntfy,
            url: String::new(),
            topic: None,
            secret: None,
            enabled: true,
            min_severity: Severity::Warning,
            recoveries: true,
            categories: vec![],
        }
    }

    fn event(severity: Severity, problem: Option<ProblemState>) -> Event {
        Event {
            id: 1,
            at: 0,
            category: EventCategory::Container,
            kind: "unhealthy".into(),
            severity,
            subject: "gitea".into(),
            title: "gitea is unhealthy".into(),
            detail: None,
            actor: None,
            service: None,
            problem: problem.map(|state| ProblemRef { key: "container:gitea:unhealthy".into(), state }),
        }
    }

    fn opened() -> Event {
        event(Severity::Warning, Some(ProblemState::Opened))
    }

    fn resolved() -> Event {
        event(Severity::Warning, Some(ProblemState::Resolved))
    }

    /// The default for a new channel: problems and recoveries.
    #[test]
    fn problems_and_recoveries_by_default() {
        let ch = channel();
        assert!(wants(&ch, &opened()));
        assert!(wants(&ch, &resolved()));
        assert!(wants(&ch, &event(Severity::Error, None)));
        assert!(!wants(&ch, &event(Severity::Info, None)), "routine events stay in the app");
    }

    #[test]
    fn channels_filter_by_severity_category_and_recoveries() {
        let quiet = Channel { recoveries: false, ..channel() };
        assert!(!wants(&quiet, &resolved()));

        let errors = Channel { min_severity: Severity::Error, ..channel() };
        assert!(!wants(&errors, &opened()));
        assert!(!wants(&errors, &resolved()), "a warning's recovery is below the bar too");

        let backups = Channel { categories: vec![EventCategory::Backup], ..channel() };
        assert!(!wants(&backups, &opened()));

        let off = Channel { enabled: false, ..channel() };
        assert!(!wants(&off, &event(Severity::Error, None)));
    }

    #[test]
    fn a_flapping_problem_rings_once_and_resolves_once() {
        let mut g = FloodGuard::default();
        assert!(g.allow(1, &opened(), 0));
        assert!(g.allow(1, &resolved(), 60));
        assert!(!g.allow(1, &opened(), 120), "reopened within the window");
        assert!(!g.allow(1, &resolved(), 180), "and cleared before anyone heard");
        assert!(g.due(FLOOD_WINDOW, |_| false).is_empty());
    }

    #[test]
    fn a_held_opening_is_sent_late_if_the_problem_stuck() {
        let mut g = FloodGuard::default();
        assert!(g.allow(1, &opened(), 0));
        assert!(g.allow(1, &resolved(), 60));
        assert!(!g.allow(1, &opened(), 120));
        assert!(g.due(FLOOD_WINDOW - 1, |_| true).is_empty(), "not yet");
        let due = g.due(FLOOD_WINDOW, |k| k == "container:gitea:unhealthy");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].0, 1);
        assert!(g.allow(1, &resolved(), FLOOD_WINDOW + 60), "its recovery follows as usual");
    }

    #[test]
    fn channels_are_guarded_separately() {
        let mut g = FloodGuard::default();
        assert!(g.allow(1, &opened(), 0));
        assert!(g.allow(2, &opened(), 0));
    }

    #[test]
    fn a_crash_loop_sends_one_crash_per_window() {
        let mut g = FloodGuard::default();
        let crash = Event { kind: "crashed".into(), ..event(Severity::Error, None) };
        assert!(g.allow(1, &crash, 0));
        assert!(!g.allow(1, &crash, 30));
        assert!(!g.allow(1, &crash, FLOOD_WINDOW - 1));
        assert!(g.allow(1, &crash, FLOOD_WINDOW));
        let other = Event { subject: "immich".into(), ..crash };
        assert!(g.allow(1, &other, FLOOD_WINDOW + 1));
    }

    /// The guard lives in memory; a problem announced before a restart still
    /// gets its recovery after one.
    #[test]
    fn a_recovery_after_a_restart_is_sent() {
        let mut g = FloodGuard::default();
        assert!(g.allow(1, &resolved(), 0));
    }
}
