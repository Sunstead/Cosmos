import { describe, expect, it } from 'vitest';
import { backupHealth, INTERRUPTED_AFTER_MS } from '@/lib/backups';
import { bodyRadius, orbitFraction } from '@/components/constellation';
import { BackupsStatus } from '@/generated/BackupsStatus';

function status(partial: Partial<BackupsStatus> = {}): BackupsStatus {
  return {
    generated_at: '2026-01-01T03:00:00Z',
    stale: false,
    last_run: '2026-01-01T02:00:00Z',
    next_run: null,
    timer_last_fired: '2026-01-01T02:00:00Z',
    last_exit_code: 0,
    duration_secs: 60,
    repo_label: 'nas',
    repo_size_bytes: null,
    snapshot_count: 0,
    snapshots: [],
    retention: null,
    postgres_dump: null,
    heartbeat: null,
    ...partial,
  };
}

describe('backupHealth', () => {
  it('is healthy by default', () => {
    expect(backupHealth(status())).toBe('healthy');
  });

  it('reads a timer that fired after the last status as running, then interrupted', () => {
    const fired = Date.parse('2026-01-02T02:00:00Z');
    const s = status({ timer_last_fired: '2026-01-02T02:00:00Z' });
    expect(backupHealth(s, fired + 60_000)).toBe('running');
    expect(backupHealth(s, fired + INTERRUPTED_AFTER_MS)).toBe('interrupted');
  });

  it('flags a non-zero exit', () => {
    expect(backupHealth(status({ last_exit_code: 3 }))).toBe('failed');
  });

  it('flags staleness', () => {
    expect(backupHealth(status({ stale: true }))).toBe('stale');
  });

  it('ranks interrupted above failed and stale', () => {
    expect(
      backupHealth(
        status({ timer_last_fired: '2026-01-02T00:00:00Z', last_exit_code: 1, stale: true }),
        Date.parse('2026-01-03T00:00:00Z'),
      ),
    ).toBe('interrupted');
  });
});

describe('constellation geometry', () => {
  it('grows radius with memory, within bounds', () => {
    expect(bodyRadius(0)).toBe(14);
    expect(bodyRadius(16 * 1024 ** 3)).toBeGreaterThan(bodyRadius(4 * 1024 ** 3));
    expect(bodyRadius(4096 * 1024 ** 3)).toBe(36);
  });

  it('centres a single node and spreads the rest outward', () => {
    expect(orbitFraction(0, 1)).toBe(0);
    expect(orbitFraction(0, 3)).toBeCloseTo(0.38);
    expect(orbitFraction(2, 3)).toBeCloseTo(0.9);
  });
});
