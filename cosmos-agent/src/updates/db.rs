//! Update state in `state.db` (migration in `store.rs`).

use crate::error::AgentError;
use cosmos_common::types::{ UpdatePolicy, UpdateRun, UpdateRunKind, UpdateRunState };
use rusqlite::{ params, Connection, OptionalExtension, Row };
use std::collections::HashMap;

/// A run plus what only the agent needs to drive it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRun {
    pub run: UpdateRun,
    pub services: Vec<String>,
    pub run_id: Option<u64>,
    pub watch_until: Option<i64>,
}

/// Records `tags` as seen now unless they were seen before. Returns every
/// first-seen time for the repository.
pub fn see(conn: &Connection, repo: &str, tags: &[String], now: i64) -> Result<HashMap<String, i64>, AgentError> {
    let tx = conn.unchecked_transaction().map_err(AgentError::internal)?;
    {
        let mut insert = tx
            .prepare_cached("INSERT OR IGNORE INTO update_seen (repo, tag, first_seen) VALUES (?1, ?2, ?3)")
            .map_err(AgentError::internal)?;
        for t in tags {
            insert.execute(params![repo, t, now]).map_err(AgentError::internal)?;
        }
    }
    tx.commit().map_err(AgentError::internal)?;
    let mut stmt = conn.prepare_cached("SELECT tag, first_seen FROM update_seen WHERE repo = ?1").map_err(AgentError::internal)?;
    let rows = stmt.query_map([repo], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(AgentError::internal)?;
    rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)
}

pub fn policies(conn: &Connection) -> Result<HashMap<String, (UpdatePolicy, Option<String>)>, AgentError> {
    let mut stmt = conn.prepare_cached("SELECT unit, policy, paused FROM update_policy").map_err(AgentError::internal)?;
    let rows = stmt
        .query_map([], |r| {
            let policy: String = r.get(1)?;
            Ok((r.get::<_, String>(0)?, (UpdatePolicy::parse(&policy).unwrap_or_default(), r.get::<_, Option<String>>(2)?)))
        })
        .map_err(AgentError::internal)?;
    rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)
}

/// Sets the policy and clears any pause: choosing again is how a paused unit
/// resumes.
pub fn set_policy(conn: &Connection, unit: &str, policy: UpdatePolicy) -> Result<(), AgentError> {
    conn.execute(
        "INSERT INTO update_policy (unit, policy, paused) VALUES (?1, ?2, NULL)
         ON CONFLICT (unit) DO UPDATE SET policy = ?2, paused = NULL",
        params![unit, policy.as_str()]
    ).map_err(AgentError::internal)?;
    Ok(())
}

pub fn pause(conn: &Connection, unit: &str, reason: &str) -> Result<(), AgentError> {
    conn.execute(
        "INSERT INTO update_policy (unit, policy, paused) VALUES (?1, 'manual', ?2)
         ON CONFLICT (unit) DO UPDATE SET paused = ?2",
        params![unit, reason]
    ).map_err(AgentError::internal)?;
    Ok(())
}

const COLUMNS: &str =
    "id, unit, kind, from_tag, to_tag, by, services, state, requested_at, finished_at, run_id, run_url, detail, watch_until";

fn row_to_run(r: &Row) -> rusqlite::Result<Option<StoredRun>> {
    let (Some(kind), Some(state)) = (
        UpdateRunKind::parse(&r.get::<_, String>(2)?),
        UpdateRunState::parse(&r.get::<_, String>(7)?),
    ) else {
        return Ok(None);
    };
    let services: String = r.get(6)?;
    Ok(
        Some(StoredRun {
            run: UpdateRun {
                id: r.get(0)?,
                unit: r.get(1)?,
                kind,
                from: r.get(3)?,
                to: r.get(4)?,
                by: r.get(5)?,
                state,
                requested_at: r.get(8)?,
                finished_at: r.get(9)?,
                run_url: r.get(11)?,
                detail: r.get(12)?,
                step: None,
                watch_until: None,
            },
            services: serde_json::from_str(&services).unwrap_or_default(),
            run_id: r.get::<_, Option<i64>>(10)?.map(|i| i as u64),
            watch_until: r.get(13)?,
        })
    )
}

/// Inserts or replaces the run.
pub fn save_run(conn: &Connection, s: &StoredRun) -> Result<(), AgentError> {
    let r = &s.run;
    conn.execute(
        &format!("INSERT OR REPLACE INTO update_runs ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"),
        params![
            r.id,
            r.unit,
            r.kind.as_str(),
            r.from,
            r.to,
            r.by,
            serde_json::to_string(&s.services).unwrap_or_else(|_| "[]".into()),
            r.state.as_str(),
            r.requested_at,
            r.finished_at,
            s.run_id.map(|i| i as i64),
            r.run_url,
            r.detail,
            s.watch_until
        ]
    ).map_err(AgentError::internal)?;
    Ok(())
}

/// The newest `limit` runs, newest first.
pub fn recent_runs(conn: &Connection, limit: usize) -> Result<Vec<StoredRun>, AgentError> {
    let mut stmt = conn
        .prepare_cached(&format!("SELECT {COLUMNS} FROM update_runs ORDER BY requested_at DESC, rowid DESC LIMIT ?1"))
        .map_err(AgentError::internal)?;
    let rows = stmt.query_map([limit as i64], row_to_run).map_err(AgentError::internal)?;
    let rows: Vec<Option<StoredRun>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    Ok(rows.into_iter().flatten().collect())
}

/// Runs not finished, oldest first: what the task resumes after a restart.
pub fn open_runs(conn: &Connection) -> Result<Vec<StoredRun>, AgentError> {
    let mut stmt = conn
        .prepare_cached(
            &format!("SELECT {COLUMNS} FROM update_runs WHERE state NOT IN ('done', 'failed', 'broken') ORDER BY requested_at")
        )
        .map_err(AgentError::internal)?;
    let rows = stmt.query_map([], row_to_run).map_err(AgentError::internal)?;
    let rows: Vec<Option<StoredRun>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    Ok(rows.into_iter().flatten().collect())
}

/// The tag the unit's last finished update came from, to roll back to.
pub fn previous(conn: &Connection, unit: &str) -> Result<Option<String>, AgentError> {
    conn.query_row(
        "SELECT from_tag FROM update_runs WHERE unit = ?1 AND kind = 'update' AND state IN ('done', 'broken')
         ORDER BY requested_at DESC LIMIT 1",
        [unit],
        |r| r.get(0)
    )
        .optional()
        .map_err(AgentError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn run(id: &str, state: UpdateRunState, at: i64) -> StoredRun {
        StoredRun {
            run: UpdateRun {
                id: id.into(),
                unit: "binwiederhier/ntfy".into(),
                kind: UpdateRunKind::Update,
                from: "v2.28.0".into(),
                to: "v2.28.1".into(),
                by: "pwb".into(),
                state,
                requested_at: at,
                finished_at: None,
                run_url: None,
                detail: None,
                step: None,
                watch_until: None,
            },
            services: vec!["ntfy".into()],
            run_id: Some(8),
            watch_until: None,
        }
    }

    #[test]
    fn tags_keep_the_first_time_they_were_seen() {
        let store = Store::in_memory();
        store.with(|c| {
            see(c, "postgres", &["16.16-alpine".into()], 100).unwrap();
            let seen = see(c, "postgres", &["16.16-alpine".into(), "16.17-alpine".into()], 200).unwrap();
            assert_eq!(seen["16.16-alpine"], 100);
            assert_eq!(seen["16.17-alpine"], 200);
        });
    }

    #[test]
    fn policies_pause_and_resume() {
        let store = Store::in_memory();
        store.with(|c| {
            set_policy(c, "postgres", UpdatePolicy::Patch).unwrap();
            pause(c, "postgres", "16.16-alpine broke it").unwrap();
            assert_eq!(policies(c).unwrap()["postgres"], (UpdatePolicy::Patch, Some("16.16-alpine broke it".into())));
            set_policy(c, "postgres", UpdatePolicy::Patch).unwrap();
            assert_eq!(policies(c).unwrap()["postgres"].1, None);
            pause(c, "nextcloud", "x").unwrap();
            assert_eq!(policies(c).unwrap()["nextcloud"].0, UpdatePolicy::Manual);
        });
    }

    #[test]
    fn runs_round_trip_and_resume() {
        let store = Store::in_memory();
        store.with(|c| {
            save_run(c, &run("a", UpdateRunState::Done, 100)).unwrap();
            let mut b = run("b", UpdateRunState::Running, 200);
            save_run(c, &b).unwrap();
            assert_eq!(open_runs(c).unwrap(), [b.clone()]);
            b.run.state = UpdateRunState::Watching;
            b.watch_until = Some(900);
            save_run(c, &b).unwrap();
            assert_eq!(open_runs(c).unwrap()[0].watch_until, Some(900));
            assert_eq!(recent_runs(c, 10).unwrap().iter().map(|r| r.run.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
            assert_eq!(previous(c, "binwiederhier/ntfy").unwrap().as_deref(), Some("v2.28.0"));
        });
    }
}
