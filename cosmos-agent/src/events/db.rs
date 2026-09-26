//! The event log's tables in `state.db` (migrations in `store.rs`).

use super::{ NewEvent, ProblemSpec, Resolution };
use crate::error::AgentError;
use cosmos_common::types::{ Event, EventCategory, Problem, ProblemRef, ProblemState, Severity };
use rusqlite::{ params, Connection, OptionalExtension, Row };

const EVENT_COLUMNS: &str =
    "id, at, category, kind, severity, subject, title, detail, actor, service, problem_key, problem_state";

const PROBLEM_COLUMNS: &str =
    "key, category, kind, severity, subject, title, detail, service, opened_at, event_id";

/// `None` for a row this build doesn't understand (written by a newer agent
/// that was then rolled back), which is skipped rather than failing the page.
fn row_to_event(r: &Row) -> rusqlite::Result<Option<Event>> {
    let category: String = r.get(2)?;
    let severity: String = r.get(4)?;
    let problem_key: Option<String> = r.get(10)?;
    let problem_state: Option<String> = r.get(11)?;
    let (Some(category), Some(severity)) = (EventCategory::parse(&category), Severity::parse(&severity)) else {
        return Ok(None);
    };
    Ok(
        Some(Event {
            id: r.get(0)?,
            at: r.get(1)?,
            category,
            kind: r.get(3)?,
            severity,
            subject: r.get(5)?,
            title: r.get(6)?,
            detail: r.get(7)?,
            actor: r.get(8)?,
            service: r.get(9)?,
            problem: problem_key.zip(problem_state.as_deref().and_then(ProblemState::parse)).map(
                |(key, state)| ProblemRef { key, state }
            ),
        })
    )
}

fn row_to_problem(r: &Row) -> rusqlite::Result<Option<Problem>> {
    let category: String = r.get(1)?;
    let severity: String = r.get(3)?;
    let (Some(category), Some(severity)) = (EventCategory::parse(&category), Severity::parse(&severity)) else {
        return Ok(None);
    };
    Ok(
        Some(Problem {
            key: r.get(0)?,
            category,
            kind: r.get(2)?,
            severity,
            subject: r.get(4)?,
            title: r.get(5)?,
            detail: r.get(6)?,
            service: r.get(7)?,
            opened_at: r.get(8)?,
            event_id: r.get(9)?,
        })
    )
}

fn insert(conn: &Connection, at: i64, e: &NewEvent, problem: Option<(&str, ProblemState)>) -> rusqlite::Result<Event> {
    conn.execute(
        "INSERT INTO events (at, category, kind, severity, subject, title, detail, actor, service, problem_key, problem_state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            at,
            e.category.as_str(),
            e.kind,
            e.severity.as_str(),
            e.subject,
            e.title,
            e.detail,
            e.actor,
            e.service,
            problem.map(|(k, _)| k),
            problem.map(|(_, s)| s.as_str())
        ]
    )?;
    Ok(Event {
        id: conn.last_insert_rowid(),
        at,
        category: e.category,
        kind: e.kind.to_string(),
        severity: e.severity,
        subject: e.subject.clone(),
        title: e.title.clone(),
        detail: e.detail.clone(),
        actor: e.actor.clone(),
        service: e.service.clone(),
        problem: problem.map(|(key, state)| ProblemRef { key: key.to_string(), state }),
    })
}

pub fn record(conn: &Connection, at: i64, e: &NewEvent) -> Result<Event, AgentError> {
    insert(conn, at, e, None).map_err(AgentError::internal)
}

/// Writes the opening event and the open problem together.
pub fn open(conn: &Connection, at: i64, p: &ProblemSpec) -> Result<(Event, Problem), AgentError> {
    let tx = conn.unchecked_transaction().map_err(AgentError::internal)?;
    let event = insert(&tx, at, &p.event(), Some((&p.key, ProblemState::Opened))).map_err(AgentError::internal)?;
    tx.execute(
        &format!("INSERT OR REPLACE INTO problems ({PROBLEM_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
        params![
            p.key,
            p.category.as_str(),
            p.kind,
            p.severity.as_str(),
            p.subject,
            p.title,
            p.detail,
            p.service,
            at,
            event.id
        ]
    ).map_err(AgentError::internal)?;
    tx.commit().map_err(AgentError::internal)?;
    let problem = Problem {
        key: p.key.clone(),
        category: p.category,
        kind: p.kind.to_string(),
        severity: p.severity,
        subject: p.subject.clone(),
        title: p.title.clone(),
        detail: p.detail.clone(),
        service: p.service.clone(),
        opened_at: at,
        event_id: event.id,
    };
    Ok((event, problem))
}

/// Writes the resolving event and closes the problem together. The event
/// takes the problem's category, subject, service and severity.
pub fn resolve(conn: &Connection, at: i64, problem: &Problem, r: &Resolution) -> Result<Event, AgentError> {
    let tx = conn.unchecked_transaction().map_err(AgentError::internal)?;
    let e = NewEvent {
        category: problem.category,
        kind: "resolved",
        severity: problem.severity,
        subject: problem.subject.clone(),
        title: r.title.clone(),
        detail: r.detail.clone(),
        actor: None,
        service: problem.service.clone(),
    };
    let event = insert(&tx, at, &e, Some((&problem.key, ProblemState::Resolved))).map_err(AgentError::internal)?;
    tx.execute("DELETE FROM problems WHERE key = ?1", [&problem.key]).map_err(AgentError::internal)?;
    tx.commit().map_err(AgentError::internal)?;
    Ok(event)
}

pub fn problems(conn: &Connection) -> Result<Vec<Problem>, AgentError> {
    let mut stmt = conn
        .prepare_cached(&format!("SELECT {PROBLEM_COLUMNS} FROM problems ORDER BY opened_at, key"))
        .map_err(AgentError::internal)?;
    let rows = stmt.query_map([], row_to_problem).map_err(AgentError::internal)?;
    let rows: Vec<Option<Problem>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    Ok(rows.into_iter().flatten().collect())
}

/// Up to `limit` events, and whether more matched. `after` pages forward
/// (oldest first); otherwise backward from `before`, or from the newest
/// (newest first).
pub fn page(
    conn: &Connection,
    after: Option<i64>,
    before: Option<i64>,
    limit: usize
) -> Result<(Vec<Event>, bool), AgentError> {
    let (sql, bound) = match after {
        Some(after) => (format!("SELECT {EVENT_COLUMNS} FROM events WHERE id > ?1 ORDER BY id ASC LIMIT ?2"), after),
        None =>
            (
                format!("SELECT {EVENT_COLUMNS} FROM events WHERE id < ?1 ORDER BY id DESC LIMIT ?2"),
                before.unwrap_or(i64::MAX),
            ),
    };
    let mut stmt = conn.prepare_cached(&sql).map_err(AgentError::internal)?;
    // One extra row says whether there is more without a second query.
    let rows = stmt
        .query_map(params![bound, (limit + 1) as i64], row_to_event)
        .map_err(AgentError::internal)?;
    let mut events: Vec<Option<Event>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    let more = events.len() > limit;
    events.truncate(limit);
    Ok((events.into_iter().flatten().collect(), more))
}

pub fn latest_id(conn: &Connection) -> Result<i64, AgentError> {
    conn.query_row("SELECT COALESCE(MAX(id), 0) FROM events", [], |r| r.get(0)).map_err(AgentError::internal)
}

/// Deletes events older than `before` (unix seconds), except any that opened
/// a problem still open. Returns how many went.
pub fn prune(conn: &Connection, before: i64) -> Result<usize, AgentError> {
    conn.execute(
        "DELETE FROM events WHERE at < ?1 AND id NOT IN (SELECT event_id FROM problems)",
        [before]
    ).map_err(AgentError::internal)
}

pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, AgentError> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map_err(AgentError::internal)
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), AgentError> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value]
    ).map_err(AgentError::internal)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn event(title: &str) -> NewEvent {
        NewEvent {
            category: EventCategory::Container,
            kind: "crashed",
            severity: Severity::Error,
            subject: "gitea".into(),
            title: title.into(),
            detail: None,
            actor: None,
            service: Some("gitea".into()),
        }
    }

    fn spec(key: &str) -> ProblemSpec {
        ProblemSpec {
            key: key.into(),
            category: EventCategory::Disk,
            kind: "disk_warning",
            severity: Severity::Warning,
            subject: "/".into(),
            title: "/ is 86% full".into(),
            detail: Some("360 GB of 418 GB used".into()),
            service: None,
        }
    }

    #[test]
    fn events_round_trip_and_page_both_ways() {
        let store = Store::in_memory();
        store.with(|c| {
            for i in 1..=5 {
                record(c, 100 + i, &event(&format!("e{i}"))).unwrap();
            }
            assert_eq!(latest_id(c).unwrap(), 5);

            let (newest, more) = page(c, None, None, 2).unwrap();
            assert_eq!(newest.iter().map(|e| e.id).collect::<Vec<_>>(), [5, 4]);
            assert!(more);

            let (older, more) = page(c, None, Some(2), 10).unwrap();
            assert_eq!(older.iter().map(|e| e.id).collect::<Vec<_>>(), [1]);
            assert!(!more);

            let (after, more) = page(c, Some(3), None, 10).unwrap();
            assert_eq!(after.iter().map(|e| e.id).collect::<Vec<_>>(), [4, 5]);
            assert!(!more);
            assert_eq!(after[0].title, "e4");
            assert_eq!(after[0].service.as_deref(), Some("gitea"));
            assert_eq!(after[0].problem, None);
        });
    }

    #[test]
    fn opening_and_resolving_writes_both_sides() {
        let store = Store::in_memory();
        store.with(|c| {
            let (opened, problem) = open(c, 100, &spec("disk:/:warning")).unwrap();
            assert_eq!(opened.problem, Some(ProblemRef { key: "disk:/:warning".into(), state: ProblemState::Opened }));
            assert_eq!(problem.event_id, opened.id);
            assert_eq!(problems(c).unwrap(), vec![problem.clone()]);

            let resolution = Resolution { key: problem.key.clone(), title: "/ is below 80% again".into(), detail: None };
            let resolved = resolve(c, 200, &problem, &resolution).unwrap();
            assert_eq!(resolved.kind, "resolved");
            assert_eq!(resolved.severity, Severity::Warning, "a resolution carries its problem's severity");
            assert_eq!(resolved.category, EventCategory::Disk);
            assert_eq!(resolved.problem.unwrap().state, ProblemState::Resolved);
            assert!(problems(c).unwrap().is_empty());
        });
    }

    #[test]
    fn pruning_keeps_what_an_open_problem_points_at() {
        let store = Store::in_memory();
        store.with(|c| {
            record(c, 10, &event("old")).unwrap();
            let (opened, _) = open(c, 20, &spec("disk:/:warning")).unwrap();
            record(c, 500, &event("new")).unwrap();

            assert_eq!(prune(c, 100).unwrap(), 1);
            let (left, _) = page(c, None, None, 10).unwrap();
            assert_eq!(left.iter().map(|e| e.id).collect::<Vec<_>>(), [3, opened.id]);
        });
    }

    #[test]
    fn rows_from_a_newer_agent_are_skipped() {
        let store = Store::in_memory();
        store.with(|c| {
            record(c, 1, &event("known")).unwrap();
            c.execute(
                "INSERT INTO events (at, category, kind, severity, subject, title) VALUES (2, 'health', 'x', 'info', 's', 't')",
                []
            ).unwrap();
            let (events, _) = page(c, None, None, 10).unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].title, "known");
        });
    }

    #[test]
    fn meta_values_overwrite() {
        let store = Store::in_memory();
        store.with(|c| {
            assert_eq!(meta_get(c, "version").unwrap(), None);
            meta_set(c, "version", "0.4.0").unwrap();
            meta_set(c, "version", "0.5.0").unwrap();
            assert_eq!(meta_get(c, "version").unwrap().as_deref(), Some("0.5.0"));
        });
    }
}
