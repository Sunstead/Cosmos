import { describe, expect, it } from 'vitest';
import {
  certStatus,
  compareChecks,
  formatUptime,
  intervalLabel,
  uptimeTone,
} from './uptime';
import { UptimeEntry } from '@/generated/UptimeEntry';

function entry(name: string, state: UptimeEntry['state']): UptimeEntry {
  return {
    check: {
      id: name,
      source: 'custom',
      name,
      kind: 'http',
      target: 'https://example.com/',
      interval_secs: 60,
      enabled: true,
      any_status: false,
      service: null,
    },
    state,
    since: null,
    recent: [],
    stats: { day: null, month: null, quarter: null, latency_ms: null },
    cert: null,
  };
}

describe('uptime', () => {
  it('never rounds a failure up to 100%', () => {
    expect(formatUptime(1)).toBe('100%');
    expect(formatUptime(0.99999)).toBe('99.99%');
    expect(formatUptime(0.9934)).toBe('99.34%');
    expect(formatUptime(0.5)).toBe('50.0%');
    expect(formatUptime(null)).toBe('n/a');
  });

  it('colours uptime by how much it matters', () => {
    expect(uptimeTone(1)).toBe('success');
    expect(uptimeTone(0.995)).toBe('warning');
    expect(uptimeTone(0.9)).toBe('error');
    expect(uptimeTone(null)).toBeNull();
  });

  it('calls a certificate overdue in its last quarter', () => {
    const cert = { not_before: 0, not_after: 90 * 86_400 };
    expect(certStatus(cert, 60 * 86_400)).toEqual({ days: 30, overdue: false });
    expect(certStatus(cert, 70 * 86_400)).toEqual({ days: 20, overdue: true });
  });

  it('puts problems first', () => {
    const sorted = [
      entry('b', 'up'),
      entry('a', 'paused'),
      entry('c', 'down'),
      entry('a', 'up'),
    ].sort(compareChecks);
    expect(sorted.map((e) => `${e.check.name}:${e.state}`)).toEqual([
      'c:down',
      'a:up',
      'b:up',
      'a:paused',
    ]);
  });

  it('labels intervals briefly', () => {
    expect(intervalLabel(30)).toBe('30s');
    expect(intervalLabel(300)).toBe('5m');
    expect(intervalLabel(3600)).toBe('1h');
  });
});
