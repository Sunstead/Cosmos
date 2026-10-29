//! SQLite schema and pragmas for the metrics store.

use rusqlite::Connection;

/// WAL is not optional here: range queries run from HTTP handlers while the
/// writer thread is flushing and the rollup job is running. Under the default
/// rollback journal those would serialise and surface as `SQLITE_BUSY`.
///
/// `synchronous = NORMAL` with WAL means commits don't fsync at all — the
/// fsync happens at checkpoint. A process crash is safe; a power cut may cost
/// the last few seconds of metrics, which is a fine trade for a graph.
///
/// `temp_store = MEMORY` is what lets the container run with `read_only: true`
/// — otherwise SQLite tries to write temp files and fails.
pub const PRAGMAS: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA wal_autocheckpoint = 1000;
    PRAGMA foreign_keys = OFF;
";

/// `ts INTEGER PRIMARY KEY` makes the timestamp the rowid, so range scans are
/// ordered table scans with no secondary index to maintain.
///
/// The rolled-up tiers carry avg *and* max so a zoomed-out chart can't hide a
/// spike, plus `n` so the UI can tell a gap from a genuine zero.
const DDL: &str = "
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_1s (
        ts            INTEGER PRIMARY KEY,
        cpu_pct       REAL    NOT NULL,
        mem_used      INTEGER NOT NULL,
        swap_used     INTEGER NOT NULL,
        net_rx_bps    REAL    NOT NULL,
        net_tx_bps    REAL    NOT NULL,
        disk_read_bps  REAL   NOT NULL,
        disk_write_bps REAL   NOT NULL,
        load1         REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_1m (
        ts                 INTEGER PRIMARY KEY,
        cpu_avg            REAL NOT NULL,
        cpu_max            REAL NOT NULL,
        mem_avg            REAL NOT NULL,
        swap_avg           REAL NOT NULL,
        net_rx_avg         REAL NOT NULL,
        net_rx_max         REAL NOT NULL,
        net_tx_avg         REAL NOT NULL,
        net_tx_max         REAL NOT NULL,
        disk_read_avg      REAL NOT NULL,
        disk_read_max      REAL NOT NULL,
        disk_write_avg     REAL NOT NULL,
        disk_write_max     REAL NOT NULL,
        load1_avg          REAL NOT NULL,
        n                  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_5m (
        ts                 INTEGER PRIMARY KEY,
        cpu_avg            REAL NOT NULL,
        cpu_max            REAL NOT NULL,
        mem_avg            REAL NOT NULL,
        swap_avg           REAL NOT NULL,
        net_rx_avg         REAL NOT NULL,
        net_rx_max         REAL NOT NULL,
        net_tx_avg         REAL NOT NULL,
        net_tx_max         REAL NOT NULL,
        disk_read_avg      REAL NOT NULL,
        disk_read_max      REAL NOT NULL,
        disk_write_avg     REAL NOT NULL,
        disk_write_max     REAL NOT NULL,
        load1_avg          REAL NOT NULL,
        n                  INTEGER NOT NULL
    );
";

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(PRAGMAS)?;
    conn.execute_batch(DDL)?;
    Ok(())
}

pub fn get_cursor(conn: &Connection, key: &str) -> i64 {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
        row.get::<_, String>(0)
    })
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

pub fn set_cursor(conn: &Connection, key: &str, value: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value.to_string()]
    )?;
    Ok(())
}
