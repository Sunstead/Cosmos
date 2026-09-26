import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnreachableTracker } from './use-unreachable-alerts';

describe('UnreachableTracker', () => {
  let alerts: [string, string, string][];
  let tracker: UnreachableTracker;
  let minutes: number;

  beforeEach(() => {
    vi.useFakeTimers();
    alerts = [];
    minutes = 3;
    tracker = new UnreachableTracker(
      (title, body, tone) => alerts.push([title, body, tone]),
      (id) => (id === 'gone' ? null : 'jupiter'),
      () => minutes,
    );
  });

  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it('says so after the delay, through retries, and when it is back', () => {
    tracker.onStatus('n1', 'online', 'offline');
    vi.advanceTimersByTime(60_000);
    tracker.onStatus('n1', 'offline', 'connecting');
    tracker.onStatus('n1', 'connecting', 'offline');
    expect(alerts).toEqual([]);

    vi.advanceTimersByTime(2 * 60_000);
    expect(alerts).toEqual([['jupiter is unreachable', "It hasn't answered for 3 minutes.", 'error']]);

    vi.advanceTimersByTime(4 * 60_000);
    tracker.onStatus('n1', 'connecting', 'online');
    expect(alerts.at(-1)).toEqual(['jupiter is back', 'It was unreachable for 7m.', 'success']);
  });

  it('stays quiet about a short blip', () => {
    tracker.onStatus('n1', 'online', 'offline');
    vi.advanceTimersByTime(60_000);
    tracker.onStatus('n1', 'offline', 'online');
    vi.advanceTimersByTime(10 * 60_000);
    expect(alerts).toEqual([]);
  });

  it('can be turned off', () => {
    minutes = 0;
    tracker.onStatus('n1', 'online', 'offline');
    vi.advanceTimersByTime(60 * 60_000);
    expect(alerts).toEqual([]);
  });

  it('forgets a node removed while down', () => {
    tracker.onStatus('gone', 'online', 'connecting');
    vi.advanceTimersByTime(10 * 60_000);
    expect(alerts).toEqual([]);
  });
});
