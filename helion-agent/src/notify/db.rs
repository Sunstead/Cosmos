//! Notification channels in `state.db` (migration in `store.rs`), and the
//! settings kept in the event log's `meta` table.

use super::Channel;
use crate::{ error::AgentError, events::db::{ meta_get, meta_set } };
use cosmos_common::types::{ ChannelKind, EventCategory, NotifySettings, Severity };
use rusqlite::{ params, Connection, OptionalExtension, Row };

const COLUMNS: &str = "id, name, kind, url, topic, secret, enabled, min_severity, recoveries, categories";
const LINK_URL: &str = "notify_link_url";

fn categories_to_text(c: &[EventCategory]) -> String {
    let names: Vec<&str> = c.iter().map(|c| c.as_str()).collect();
    serde_json::to_string(&names).unwrap_or_else(|_| "[]".into())
}

fn categories_from_text(s: &str) -> Vec<EventCategory> {
    serde_json
        ::from_str::<Vec<String>>(s)
        .unwrap_or_default()
        .iter()
        .filter_map(|c| EventCategory::parse(c))
        .collect()
}

/// `None` for a kind this build doesn't know, which is then left alone.
fn row_to_channel(r: &Row) -> rusqlite::Result<Option<Channel>> {
    let kind: String = r.get(2)?;
    let severity: String = r.get(7)?;
    let (Some(kind), Some(min_severity)) = (ChannelKind::parse(&kind), Severity::parse(&severity)) else {
        return Ok(None);
    };
    Ok(
        Some(Channel {
            id: r.get(0)?,
            name: r.get(1)?,
            kind,
            url: r.get(3)?,
            topic: r.get(4)?,
            secret: r.get(5)?,
            enabled: r.get(6)?,
            min_severity,
            recoveries: r.get(8)?,
            categories: categories_from_text(&r.get::<_, String>(9)?),
        })
    )
}

fn map_unique(e: rusqlite::Error, name: &str) -> AgentError {
    match &e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation =>
            AgentError::BadRequest(format!("a channel named {name} already exists")),
        _ => AgentError::internal(e),
    }
}

fn parse_id(id: &str) -> Result<i64, AgentError> {
    id.parse().map_err(|_| AgentError::NotFound(format!("no channel {id}")))
}

pub fn list(conn: &Connection) -> Result<Vec<Channel>, AgentError> {
    let mut stmt = conn
        .prepare_cached(&format!("SELECT {COLUMNS} FROM notify_channels ORDER BY name"))
        .map_err(AgentError::internal)?;
    let rows = stmt.query_map([], row_to_channel).map_err(AgentError::internal)?;
    let rows: Vec<Option<Channel>> = rows.collect::<rusqlite::Result<_>>().map_err(AgentError::internal)?;
    Ok(rows.into_iter().flatten().collect())
}

pub fn get(conn: &Connection, id: &str) -> Result<Channel, AgentError> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM notify_channels WHERE id = ?1"), [parse_id(id)?], row_to_channel)
        .optional()
        .map_err(AgentError::internal)?
        .flatten()
        .ok_or_else(|| AgentError::NotFound(format!("no channel {id}")))
}

/// Inserts `c` (its `id` is ignored) and returns it with the new id.
pub fn insert(conn: &Connection, c: &Channel) -> Result<Channel, AgentError> {
    conn.execute(
        "INSERT INTO notify_channels (name, kind, url, topic, secret, enabled, min_severity, recoveries, categories)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            c.name,
            c.kind.as_str(),
            c.url,
            c.topic,
            c.secret,
            c.enabled,
            c.min_severity.as_str(),
            c.recoveries,
            categories_to_text(&c.categories)
        ]
    ).map_err(|e| map_unique(e, &c.name))?;
    Ok(Channel { id: conn.last_insert_rowid(), ..c.clone() })
}

pub fn update(conn: &Connection, c: &Channel) -> Result<(), AgentError> {
    let changed = conn
        .execute(
            "UPDATE notify_channels SET name = ?2, kind = ?3, url = ?4, topic = ?5, secret = ?6, enabled = ?7,
             min_severity = ?8, recoveries = ?9, categories = ?10 WHERE id = ?1",
            params![
                c.id,
                c.name,
                c.kind.as_str(),
                c.url,
                c.topic,
                c.secret,
                c.enabled,
                c.min_severity.as_str(),
                c.recoveries,
                categories_to_text(&c.categories)
            ]
        )
        .map_err(|e| map_unique(e, &c.name))?;
    if changed == 0 {
        return Err(AgentError::NotFound(format!("no channel {}", c.id)));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AgentError> {
    let changed = conn
        .execute("DELETE FROM notify_channels WHERE id = ?1", [parse_id(id)?])
        .map_err(AgentError::internal)?;
    if changed == 0 {
        return Err(AgentError::NotFound(format!("no channel {id}")));
    }
    Ok(())
}

pub fn settings(conn: &Connection) -> Result<NotifySettings, AgentError> {
    Ok(NotifySettings { link_url: meta_get(conn, LINK_URL)?.filter(|u| !u.is_empty()) })
}

pub fn save_settings(conn: &Connection, s: &NotifySettings) -> Result<(), AgentError> {
    meta_set(conn, LINK_URL, s.link_url.as_deref().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn channel(name: &str) -> Channel {
        Channel {
            id: 0,
            name: name.into(),
            kind: ChannelKind::Ntfy,
            url: "https://ntfy.example.com".into(),
            topic: Some("cosmos-jupiter".into()),
            secret: Some("tk_secret".into()),
            enabled: true,
            min_severity: Severity::Warning,
            recoveries: true,
            categories: vec![EventCategory::Container, EventCategory::Backup],
        }
    }

    #[test]
    fn channels_round_trip() {
        let store = Store::in_memory();
        store.with(|c| {
            let saved = insert(c, &channel("phone")).unwrap();
            assert_eq!(get(c, &saved.id.to_string()).unwrap(), saved);
            assert_eq!(list(c).unwrap(), vec![saved.clone()]);

            update(c, &Channel { enabled: false, categories: vec![], ..saved.clone() }).unwrap();
            let got = get(c, &saved.id.to_string()).unwrap();
            assert!(!got.enabled);
            assert!(got.categories.is_empty());

            delete(c, &saved.id.to_string()).unwrap();
            assert!(list(c).unwrap().is_empty());
            assert!(matches!(get(c, &saved.id.to_string()), Err(AgentError::NotFound(_))));
        });
    }

    #[test]
    fn names_are_unique_ignoring_case() {
        let store = Store::in_memory();
        store.with(|c| {
            insert(c, &channel("phone")).unwrap();
            assert!(matches!(insert(c, &channel("Phone")), Err(AgentError::BadRequest(_))));
        });
    }

    #[test]
    fn the_link_url_is_optional() {
        let store = Store::in_memory();
        store.with(|c| {
            assert_eq!(settings(c).unwrap(), NotifySettings::default());
            save_settings(c, &NotifySettings { link_url: Some("https://cosmos.example.com/events".into()) }).unwrap();
            assert_eq!(settings(c).unwrap().link_url.as_deref(), Some("https://cosmos.example.com/events"));
            save_settings(c, &NotifySettings::default()).unwrap();
            assert_eq!(settings(c).unwrap().link_url, None);
        });
    }
}
