import { createNodeSeries, MetricKey, NodeSeries } from '@/lib/ring-buffer';

/**
 * Rolling per-node metric history for the live sparklines.
 *
 * Deliberately *not* a zustand store. This is written at 1 Hz per node and
 * read every animation frame; routing that through React state would
 * re-render every subscriber on every tick, which is exactly what made the
 * node cards expensive. Components read the buffers directly and update
 * through refs — see `<Sparkline>`.
 *
 * Longer-range history lives in the agent's SQLite store and is fetched via
 * `/v1/metrics`; this is only the last minute.
 */

const CAPACITY = 60; // 60 samples at 1 Hz

const series = new Map<string, NodeSeries>();

/**
 * Per-node redraw notifications.
 *
 * Charts subscribe here rather than polling on every animation frame, so the
 * app schedules one frame per node per sample (1 Hz) instead of running a
 * 60 Hz loop that finds nothing to do 59 times out of 60.
 */
const listeners = new Map<string, Set<() => void>>();

export function subscribeNodeSeries(nodeId: string, fn: () => void): () => void {
  let set = listeners.get(nodeId);
  if (!set) {
    set = new Set();
    listeners.set(nodeId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(nodeId);
  };
}

function notify(nodeId: string) {
  const set = listeners.get(nodeId);
  if (!set) return;
  for (const fn of set) fn();
}

export function getNodeSeries(nodeId: string): NodeSeries {
  let existing = series.get(nodeId);
  if (!existing) {
    existing = createNodeSeries(CAPACITY);
    series.set(nodeId, existing);
  }
  return existing;
}

export interface MetricSample {
  cpu: number;
  ram: number;
  netRx: number;
  netTx: number;
  diskRead: number;
  diskWrite: number;
}

export function pushSample(nodeId: string, sample: MetricSample) {
  const target = getNodeSeries(nodeId);
  const now = Date.now();
  for (const key of Object.keys(sample) as MetricKey[]) {
    target[key].push(now, sample[key]);
  }
  notify(nodeId);
}

/** Drops a node's history — on removal, or when its agent restarts. */
export function clearNodeSeries(nodeId: string) {
  series.delete(nodeId);
  notify(nodeId);
}

export function resetNodeSeries(nodeId: string) {
  const existing = series.get(nodeId);
  if (!existing) return;
  for (const key of Object.keys(existing) as MetricKey[]) existing[key].clear();
  notify(nodeId);
}
