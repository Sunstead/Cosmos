import { create } from 'zustand';

export interface MetricPoint {
  timestamp: number;
  value: number;
}

interface NodeHistory {
  cpu: MetricPoint[];
  ram: MetricPoint[];
  netRx: MetricPoint[];
  netTx: MetricPoint[];
  diskRead: MetricPoint[];
  diskWrite: MetricPoint[];
}

interface MetricsHistoryStore {
  history: Record<string, NodeHistory>;
  push: (
    nodeId: string,
    data: {
      cpu: number;
      ram: number;
      netRx: number;
      netTx: number;
      diskRead: number;
      diskWrite: number;
    },
  ) => void;
  getHistory: (nodeId: string) => NodeHistory;
}

const MAX_POINTS = 60; // 60 points at 1/s = last 60 seconds

function buildEmpty(): NodeHistory {
  const now = Date.now();
  const points: MetricPoint[] = Array.from({ length: MAX_POINTS }, (_, i) => ({
    timestamp: now - (MAX_POINTS - i) * 1000,
    value: 0,
  }));
  return {
    cpu: [...points],
    ram: [...points],
    netRx: [...points],
    netTx: [...points],
    diskRead: [...points],
    diskWrite: [...points],
  };
}

const EMPTY: NodeHistory = buildEmpty();

function trimmed(points: MetricPoint[], next: MetricPoint): MetricPoint[] {
  const updated = [...points, next];
  return updated.length > MAX_POINTS ? updated.slice(-MAX_POINTS) : updated;
}

export const useMetricsHistory = create<MetricsHistoryStore>((set, get) => ({
  history: {},

  push: (nodeId, data) => {
    const now = Date.now();
    set((s) => {
      const prev = s.history[nodeId] ?? EMPTY;
      return {
        history: {
          ...s.history,
          [nodeId]: {
            cpu: trimmed(prev.cpu, { timestamp: now, value: data.cpu }),
            ram: trimmed(prev.ram, { timestamp: now, value: data.ram }),
            netRx: trimmed(prev.netRx, { timestamp: now, value: data.netRx }),
            netTx: trimmed(prev.netTx, { timestamp: now, value: data.netTx }),
            diskRead: trimmed(prev.diskRead, {
              timestamp: now,
              value: data.diskRead,
            }),
            diskWrite: trimmed(prev.diskWrite, {
              timestamp: now,
              value: data.diskWrite,
            }),
          },
        },
      };
    });
  },

  getHistory: (nodeId) => get().history[nodeId] ?? EMPTY,
}));
