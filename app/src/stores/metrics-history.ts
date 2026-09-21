import { createNodeSeries, MetricKey, NodeSeries } from '@/lib/ring-buffer';

/**
 * Last minute of per-node metrics for sparklines. Deliberately not a zustand
 * store: it's written at 1 Hz and read every frame, outside React.
 */

const CAPACITY = 60; // 60 samples at 1 Hz

const series = new Map<string, NodeSeries>();

/** Per-node redraw notifications, so charts draw once per sample, not per frame. */
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

/** Drops a node's history on removal or agent restart. */
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
