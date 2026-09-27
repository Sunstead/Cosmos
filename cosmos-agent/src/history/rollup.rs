//! Downsampling and retention.
//!
//! The one rule that makes this safe: **only fully-closed buckets are rolled
//! up**. Because a bucket is never touched again once written, the job is
//! idempotent — a crash mid-rollup just replays from the stored cursor — and
//! there's no need for `ON CONFLICT DO UPDATE` recomputation.

use super::schema::{ get_cursor, set_cursor };
use rusqlite::Connection;

pub const CURSOR_1M: &str = "rollup_1m_cursor";
pub const CURSOR_5M: &str = "rollup_5m_cursor";

/// Aggregates raw 1s samples into closed 1-minute buckets.
pub fn rollup_1m(conn: &mut Connection, now: i64) -> rusqlite::Result<usize> {
    let closed = (now / 60) * 60;
    let cursor = get_cursor(conn, CURSOR_1M);
    if closed <= cursor {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let rows = tx.execute(
        "INSERT OR IGNORE INTO metrics_1m
            (ts, cpu_avg, cpu_max, mem_avg, swap_avg,
             net_rx_avg, net_rx_max, net_tx_avg, net_tx_max,
             disk_read_avg, disk_read_max, disk_write_avg, disk_write_max,
             load1_avg, n)
         SELECT (ts / 60) * 60,
                avg(cpu_pct), max(cpu_pct), avg(mem_used), avg(swap_used),
                avg(net_rx_bps), max(net_rx_bps), avg(net_tx_bps), max(net_tx_bps),
                avg(disk_read_bps), max(disk_read_bps),
                avg(disk_write_bps), max(disk_write_bps),
                avg(load1), count(*)
         FROM metrics_1s
         WHERE ts >= ?1 AND ts < ?2
         GROUP BY (ts / 60) * 60",
        rusqlite::params![cursor, closed]
    )?;
    set_cursor(&tx, CURSOR_1M, closed)?;
    tx.commit()?;
    Ok(rows)
}

/// Aggregates 1-minute buckets into closed 5-minute buckets.
///
/// Averages are weighted by each minute's sample count: a minute cut short
/// (the agent restarted, a sample was dropped) counts for what it holds.
/// Maxima propagate exactly.
pub fn rollup_5m(conn: &mut Connection, now: i64) -> rusqlite::Result<usize> {
    let closed = (now / 300) * 300;
    let cursor = get_cursor(conn, CURSOR_5M);
    if closed <= cursor {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let rows = tx.execute(
        "INSERT OR IGNORE INTO metrics_5m
            (ts, cpu_avg, cpu_max, mem_avg, swap_avg,
             net_rx_avg, net_rx_max, net_tx_avg, net_tx_max,
             disk_read_avg, disk_read_max, disk_write_avg, disk_write_max,
             load1_avg, n)
         SELECT (ts / 300) * 300,
                sum(cpu_avg * n) / sum(n), max(cpu_max),
                sum(mem_avg * n) / sum(n), sum(swap_avg * n) / sum(n),
                sum(net_rx_avg * n) / sum(n), max(net_rx_max),
                sum(net_tx_avg * n) / sum(n), max(net_tx_max),
                sum(disk_read_avg * n) / sum(n), max(disk_read_max),
                sum(disk_write_avg * n) / sum(n), max(disk_write_max),
                sum(load1_avg * n) / sum(n), sum(n)
         FROM metrics_1m
         WHERE ts >= ?1 AND ts < ?2
         GROUP BY (ts / 300) * 300",
        rusqlite::params![cursor, closed]
    )?;
    set_cursor(&tx, CURSOR_5M, closed)?;
    tx.commit()?;
    Ok(rows)
}

/// Trims each tier to its retention window.
///
/// 1s data is only deleted up to the 1m rollup cursor, so a rollup that hasn't
/// run yet can never lose its input.
pub fn retain(
    conn: &mut Connection,
    now: i64,
    retain_1s: i64,
    retain_1m: i64,
    retain_5m: i64
) -> rusqlite::Result<usize> {
    let safe_1s = (now - retain_1s).min(get_cursor(conn, CURSOR_1M));
    let safe_1m = (now - retain_1m).min(get_cursor(conn, CURSOR_5M));

    let tx = conn.transaction()?;
    let mut deleted = tx.execute("DELETE FROM metrics_1s WHERE ts < ?1", [safe_1s])?;
    deleted += tx.execute("DELETE FROM metrics_1m WHERE ts < ?1", [safe_1m])?;
    deleted += tx.execute("DELETE FROM metrics_5m WHERE ts < ?1", [now - retain_5m])?;
    tx.commit()?;
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::schema;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        schema::init(&conn).unwrap();
        conn
    }

    fn insert_raw(conn: &Connection, ts: i64, cpu: f64) {
        conn.execute(
            "INSERT INTO metrics_1s VALUES (?1, ?2, 100, 0, 10.0, 20.0, 1.0, 2.0, 0.5)",
            rusqlite::params![ts, cpu]
        ).unwrap();
    }

    #[test]
    fn rollup_averages_and_keeps_the_peak() {
        let mut conn = db();
        // 0..59 inside one minute bucket, with a spike partway through.
        for i in 0..60 {
            insert_raw(&conn, i, if i == 30 { 90.0 } else { 10.0 });
        }
        rollup_1m(&mut conn, 120).unwrap();

        let (avg, max, n): (f64, f64, i64) = conn
            .query_row("SELECT cpu_avg, cpu_max, n FROM metrics_1m WHERE ts = 0", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();

        assert_eq!(n, 60);
        assert!((avg - 11.333).abs() < 0.01, "avg was {avg}");
        // The whole point of storing max: a zoomed-out chart still shows the
        // spike that the average buries.
        assert_eq!(max, 90.0);
    }

    #[test]
    fn open_buckets_are_left_alone() {
        let mut conn = db();
        for i in 0..90 {
            insert_raw(&conn, i, 10.0);
        }
        // now = 90s, so the minute starting at 60 is still open.
        rollup_1m(&mut conn, 90).unwrap();

        let buckets: i64 = conn
            .query_row("SELECT count(*) FROM metrics_1m", [], |r| r.get(0))
            .unwrap();
        assert_eq!(buckets, 1, "only the closed 0-59 bucket should be rolled up");
    }

    #[test]
    fn rollup_is_idempotent() {
        let mut conn = db();
        for i in 0..60 {
            insert_raw(&conn, i, 10.0);
        }
        assert_eq!(rollup_1m(&mut conn, 120).unwrap(), 1);
        // Replaying must not double-count or error.
        assert_eq!(rollup_1m(&mut conn, 120).unwrap(), 0);

        let buckets: i64 = conn
            .query_row("SELECT count(*) FROM metrics_1m", [], |r| r.get(0))
            .unwrap();
        assert_eq!(buckets, 1);
    }

    #[test]
    fn five_minute_tier_propagates_maxima_exactly() {
        let mut conn = db();
        for i in 0..300 {
            insert_raw(&conn, i, if i == 150 { 99.0 } else { 5.0 });
        }
        rollup_1m(&mut conn, 600).unwrap();
        rollup_5m(&mut conn, 600).unwrap();

        let (max, n): (f64, i64) = conn
            .query_row("SELECT cpu_max, n FROM metrics_5m WHERE ts = 0", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(max, 99.0);
        assert_eq!(n, 300, "sample counts sum through the tiers");
    }

    #[test]
    fn a_short_minute_counts_for_what_it_holds() {
        let mut conn = db();
        // A full minute at 10%, then one cut short by a restart: 6 samples at 70%.
        for i in 0..60 {
            insert_raw(&conn, i, 10.0);
        }
        for i in 60..66 {
            insert_raw(&conn, i, 70.0);
        }
        rollup_1m(&mut conn, 300).unwrap();
        rollup_5m(&mut conn, 300).unwrap();

        let (avg, n): (f64, i64) = conn
            .query_row("SELECT cpu_avg, n FROM metrics_5m WHERE ts = 0", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(n, 66);
        // (60 x 10 + 6 x 70) / 66, not the average of the two minutes (40).
        assert!((avg - 15.4545).abs() < 0.01, "avg was {avg}");
    }

    #[test]
    fn retention_never_deletes_rows_the_rollup_has_not_consumed() {
        let mut conn = db();
        for i in 0..120 {
            insert_raw(&conn, i, 10.0);
        }
        // Retention wants everything older than now-10 gone, but no rollup has
        // run, so the raw rows are still needed.
        retain(&mut conn, 1000, 10, 100, 1000).unwrap();
        let remaining: i64 = conn
            .query_row("SELECT count(*) FROM metrics_1s", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 120, "raw data must survive until it has been rolled up");

        rollup_1m(&mut conn, 1000).unwrap();
        retain(&mut conn, 1000, 10, 100, 1000).unwrap();
        let after: i64 = conn
            .query_row("SELECT count(*) FROM metrics_1s", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 0, "once rolled up, raw data past retention goes");
    }
}
