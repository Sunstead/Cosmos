//! Custom checks, service settings and hourly results in `state.db`
//! (migration in `store.rs`).

use crate::error::AgentError;
use cosmos_common::types::{ CheckKind, UptimeServiceInput };
use rusqlite::{ params, Connection, Row };
use std::collections::HashMap;

/// A check added in the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomCheck {
    pub id: i64,
    pub name: String,
    pub kind: CheckKind,
    pub target: String,
    /// `None` follows `[uptime] interval_secs`.
    pub interval_secs: Option<u32>,
    pub enabled: bool,
    pub any_status: bool,
    /// One of `[[peers]]` the target is reached through.
    pub via_peer: Option<String>,
}

/// Results within one hour, or summed over several.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tally {
    pub ok: u32,
    pub fail: u32,
    /// Over the passing results only.
    pub latency_sum: u64,
    pub latency_max: u32,
}

impl Tally {
    pub fn add(&mut self, ok: bool, latency_ms: Option<u32>) {
        if ok {
            self.ok += 1;
            let l = latency_ms.unwrap_or(0);
            self.latency_sum += u64::from(l);
            self.latency_max = self.latency_max.max(l);
        } else {
            self.fail += 1;
        }
    }

    pub fn merge(&mut self, other: &Tally) {
        self.ok += other.ok;
        self.fail += other.fail;
        self.latency_sum += other.latency_sum;
        self.latency_max = self.latency_max.max(other.latency_max);
    }

    pub fn is_empty(&self) -> bool {
        self.ok == 0 && self.fail == 0
    }
}

const COLUMNS: &str = "id, name, kind, target, interval_secs, enabled, any_status, via_peer";

/// `None` for a kind this build doesn't know, which is then left alone.
fn row_to_check(r: &Row) -> rusqlite::Result<Option<CustomCheck>> {
    let Some(kind) = CheckKind::parse(&r.get::<_, String>(2)?) else {
        return Ok(None);
    };
    Ok(
        Some(CustomCheck {
            id: r.get(0)?,
            name: r.get(1)?,
            kind,
            target: r.get(3)?,
            interval_secs: r.get(4)?,
            enabled: r.get(5)?,
            any_status: r.get(6)?,
            via_peer: r.get(7)?,
        })
    )
}

fn map_unique(e: rusqlite::Error, name: &str) -> AgentError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            AgentError::BadRequest(format!("a check named {name} already exists")),
        _ => AgentError::internal(e),
    }
}

pub fn parse_id(id: &str) -> Result<i64, AgentError> {
    id.parse().map_err(|_| AgentError::NotFound(format!("no check {id}")))
}

pub fn list(conn: &Connection) -> Result<Vec<CustomCheck>, AgentError> {
    let mut stmt = conn
        .prepare_cached(&format!("SELECT {COLUMNS} FROM uptime_checks ORDER BY name"))
        .map_err(AgentError::internal)?;
    let rows = stmt.query_map([], row_to_check).map_err(AgentError::internal)?;
    let rows: Vec<Option<CustomCheck>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    Ok(rows.into_iter().flatten().collect())
}

/// Inserts `c` (its `id` is ignored) and returns it with the new id.
pub fn insert(conn: &Connection, c: &CustomCheck) -> Result<CustomCheck, AgentError> {
    conn.execute(
        "INSERT INTO uptime_checks (name, kind, target, interval_secs, enabled, any_status, via_peer)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![c.name, c.kind.as_str(), c.target, c.interval_secs, c.enabled, c.any_status, c.via_peer]
    ).map_err(|e| map_unique(e, &c.name))?;
    Ok(CustomCheck { id: conn.last_insert_rowid(), ..c.clone() })
}

pub fn update(conn: &Connection, c: &CustomCheck) -> Result<(), AgentError> {
    let changed = conn
        .execute(
            "UPDATE uptime_checks SET name = ?2, kind = ?3, target = ?4, interval_secs = ?5, enabled = ?6,
             any_status = ?7, via_peer = ?8 WHERE id = ?1",
            params![c.id, c.name, c.kind.as_str(), c.target, c.interval_secs, c.enabled, c.any_status, c.via_peer]
        )
        .map_err(|e| map_unique(e, &c.name))?;
    if changed == 0 {
        return Err(AgentError::NotFound(format!("no check {}", c.id)));
    }
    Ok(())
}

/// Removes the check and its history.
pub fn delete(conn: &Connection, id: i64) -> Result<(), AgentError> {
    let changed = conn.execute("DELETE FROM uptime_checks WHERE id = ?1", [id]).map_err(AgentError::internal)?;
    if changed == 0 {
        return Err(AgentError::NotFound(format!("no check {id}")));
    }
    conn.execute("DELETE FROM uptime_hourly WHERE check_id = ?1", [id.to_string()]).map_err(AgentError::internal)?;
    Ok(())
}

pub fn services(conn: &Connection) -> Result<HashMap<String, UptimeServiceInput>, AgentError> {
    let mut stmt = conn
        .prepare_cached("SELECT service, enabled, path, any_status FROM uptime_services")
        .map_err(AgentError::internal)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, UptimeServiceInput { enabled: r.get(1)?, path: r.get(2)?, any_status: r.get(3)? }))
        })
        .map_err(AgentError::internal)?;
    rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)
}

pub fn save_service(conn: &Connection, service: &str, s: &UptimeServiceInput) -> Result<(), AgentError> {
    conn.execute(
        "INSERT INTO uptime_services (service, enabled, path, any_status) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (service) DO UPDATE SET enabled = ?2, path = ?3, any_status = ?4",
        params![service, s.enabled, s.path, s.any_status]
    ).map_err(AgentError::internal)?;
    Ok(())
}

/// Adds to what's stored, so each flush writes only what's new since the
/// last one.
pub fn add_hourly(conn: &Connection, rows: &[(String, i64, Tally)]) -> Result<(), AgentError> {
    let tx = conn.unchecked_transaction().map_err(AgentError::internal)?;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO uptime_hourly (check_id, hour, ok, fail, latency_sum, latency_max)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT (check_id, hour) DO UPDATE SET
                    ok = ok + excluded.ok,
                    fail = fail + excluded.fail,
                    latency_sum = latency_sum + excluded.latency_sum,
                    latency_max = max(latency_max, excluded.latency_max)"
            )
            .map_err(AgentError::internal)?;
        for (id, hour, t) in rows {
            stmt.execute(params![id, hour, t.ok, t.fail, t.latency_sum as i64, t.latency_max]).map_err(
                AgentError::internal
            )?;
        }
    }
    tx.commit().map_err(AgentError::internal)
}

/// Each check's results in hours starting at or after `since` (unix
/// seconds).
pub fn sums(conn: &Connection, since: i64) -> Result<HashMap<String, Tally>, AgentError> {
    let mut stmt = conn
        .prepare_cached(
            "SELECT check_id, sum(ok), sum(fail), sum(latency_sum), max(latency_max)
             FROM uptime_hourly WHERE hour >= ?1 GROUP BY check_id"
        )
        .map_err(AgentError::internal)?;
    let rows = stmt
        .query_map([since], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Tally {
                    ok: r.get(1)?,
                    fail: r.get(2)?,
                    latency_sum: r.get::<_, i64>(3)?.max(0) as u64,
                    latency_max: r.get(4)?,
                },
            ))
        })
        .map_err(AgentError::internal)?;
    rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)
}

pub fn prune(conn: &Connection, before: i64) -> Result<usize, AgentError> {
    conn.execute("DELETE FROM uptime_hourly WHERE hour < ?1", [before]).map_err(AgentError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn check(name: &str) -> CustomCheck {
        CustomCheck {
            id: 0,
            name: name.into(),
            kind: CheckKind::Tcp,
            target: "192.168.1.1:443".into(),
            interval_secs: None,
            enabled: true,
            any_status: false,
            via_peer: None,
        }
    }

    #[test]
    fn round_trips_checks() {
        let store = Store::in_memory();
        store.with(|c| {
            let saved = insert(c, &check("router")).unwrap();
            assert_eq!(list(c).unwrap(), std::slice::from_ref(&saved));
            update(c, &CustomCheck { interval_secs: Some(30), ..saved.clone() }).unwrap();
            assert_eq!(list(c).unwrap()[0].interval_secs, Some(30));
            assert!(matches!(insert(c, &check("Router")), Err(AgentError::BadRequest(_))));
            delete(c, saved.id).unwrap();
            assert!(list(c).unwrap().is_empty());
            assert!(matches!(delete(c, saved.id), Err(AgentError::NotFound(_))));
        });
    }

    #[test]
    fn service_settings_upsert() {
        let store = Store::in_memory();
        store.with(|c| {
            let s = UptimeServiceInput { enabled: false, path: Some("/api/ping".into()), any_status: true };
            save_service(c, "immich", &s).unwrap();
            save_service(c, "immich", &UptimeServiceInput { enabled: true, ..s.clone() }).unwrap();
            assert!(services(c).unwrap()["immich"].enabled);
        });
    }

    #[test]
    fn hourly_flushes_add_up() {
        let store = Store::in_memory();
        store.with(|c| {
            let mut t = Tally::default();
            t.add(true, Some(40));
            t.add(false, None);
            add_hourly(c, &[("svc:immich".into(), 3_600, t)]).unwrap();
            let mut more = Tally::default();
            more.add(true, Some(60));
            add_hourly(c, &[("svc:immich".into(), 3_600, more), ("svc:immich".into(), 7_200, more)]).unwrap();

            let all = sums(c, 0).unwrap();
            assert_eq!(all["svc:immich"], Tally { ok: 3, fail: 1, latency_sum: 160, latency_max: 60 });
            assert_eq!(sums(c, 7_200).unwrap()["svc:immich"].ok, 1);
            assert_eq!(prune(c, 7_200).unwrap(), 1);
        });
    }
}
