import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NodeConnection, NodeMeta, NodeStatus } from '@/api/connection';
import { AgentRequestError, LEGACY_CAPABILITIES } from '@/api/client';
import { normalizeAgentUrl } from '@/lib/agent-url';
import { getToken, deleteToken, primeToken, setToken } from '@/lib/secrets';
import { sumDisk, getMemUsagePct } from '@/lib/node-metrics';
import { clearNodeSeries, pushSample, resetNodeSeries } from './metrics-history';
import { useContainersStore } from './containers';
import { useVolumesStore } from './volumes';

export interface NodeConfig {
  id: string;
  url: string;
  /** Name the agent reports. */
  agentName: string | null;
  /** Local rename. Wins over `agentName`. */
  alias: string | null;
}

export type { NodeStatus };

export function nodeDisplayName(node: Pick<NodeConfig, 'alias' | 'agentName' | 'url'>): string {
  return node.alias || node.agentName || node.url;
}

type AddResult = { ok: true; id: string } | { ok: false; error: string };

interface NodeStore {
  nodes: NodeConfig[];
  /** Live connection state per node. Not persisted. */
  meta: Record<string, NodeMeta>;
  onlineNodes: number;

  addNode: (url: string, token?: string) => Promise<AddResult>;
  removeNode: (id: string) => void;
  /** Pass null or an empty string to fall back to the agent's name. */
  renameNode: (id: string, alias: string | null) => void;
  updateNodeToken: (id: string, token: string) => Promise<void>;
  reconnect: (id: string) => void;
}

// Connections hold EventSources and timers, so they live outside React state.
const connections = new Map<string, NodeConnection>();

export function getConnection(nodeId: string): NodeConnection | null {
  return connections.get(nodeId) ?? null;
}

export function getAllConnections(): NodeConnection[] {
  return [...connections.values()];
}

export const DEFAULT_META: NodeMeta = {
  status: 'connecting',
  capabilities: LEGACY_CAPABILITIES,
  agentVersion: null,
  apiVersion: 0,
  error: null,
};

const countOnline = (meta: Record<string, NodeMeta>) =>
  Object.values(meta).filter((m) => m.status === 'online').length;

/** Status transitions, for toasts. Registered by the UI layer. */
type StatusListener = (nodeId: string, from: NodeStatus, to: NodeStatus) => void;
const statusListeners = new Set<StatusListener>();

export function onNodeStatusChange(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function attach(nodeId: string, url: string, token: string | null): NodeConnection {
  const conn = new NodeConnection(nodeId, url, token);
  connections.set(nodeId, conn);

  conn.onMeta((meta) => {
    const prev = useNodeStore.getState().meta[nodeId]?.status;
    useNodeStore.setState((s) => {
      const next = { ...s.meta, [nodeId]: meta };
      return { meta: next, onlineNodes: countOnline(next) };
    });
    if (prev && prev !== meta.status) {
      for (const fn of statusListeners) fn(nodeId, prev, meta.status);
    }
  });

  conn.onHost((host) => {
    pushSample(nodeId, {
      cpu: host.cpu_pct,
      ram: getMemUsagePct(host),
      netRx: host.net_rx_bps,
      netTx: host.net_tx_bps,
      diskRead: sumDisk(host, 'read_bps'),
      diskWrite: sumDisk(host, 'write_bps'),
    });

    // Compare against current state, not a captured copy: a stale comparison
    // rewrote `nodes` on every sample.
    const current = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
    if (current && host.name && current.agentName !== host.name) {
      useNodeStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, agentName: host.name } : n)),
      }));
    }
  });

  conn.onContainers((containers) => {
    useContainersStore.getState().setNodeContainers(nodeId, containers);
  });

  conn.onVolumes((volumes) => {
    useVolumesStore.getState().setNodeVolumes(nodeId, volumes);
  });

  // Agent restarted: old points don't join up with the new deltas.
  conn.onReset(() => resetNodeSeries(nodeId));

  conn.start();
  return conn;
}

function detach(nodeId: string) {
  connections.get(nodeId)?.stop();
  connections.delete(nodeId);
  clearNodeSeries(nodeId);
  useContainersStore.getState().removeNode(nodeId);
  useVolumesStore.getState().removeNode(nodeId);
}

/** Accepts both the current shape and the pre-alias `{ name }` shape. */
export function migrateNode(raw: unknown): NodeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'string' || typeof n.url !== 'string') return null;

  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const legacyName = str(n.name);

  return {
    id: n.id,
    url: n.url,
    agentName: str(n.agentName) ?? (legacyName !== n.url ? legacyName : null),
    alias: str(n.alias),
  };
}

export const useNodeStore = create<NodeStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      meta: {},
      onlineNodes: 0,

      addNode: async (rawUrl, token) => {
        const url = normalizeAgentUrl(rawUrl);
        if (!url) return { ok: false, error: 'Enter a host or URL.' };
        if (get().nodes.some((n) => n.url === url)) {
          return { ok: false, error: 'This node is already added.' };
        }

        const id = crypto.randomUUID();

        // Probe first so a bad address or token is reported, not saved.
        const probe = new NodeConnection(id, url, token ?? null);
        let agentName: string | null = null;
        try {
          const info = await probe.client.getInfo();
          if (info.auth_required && !token) {
            return { ok: false, error: 'This agent requires a token.' };
          }
          agentName = (await probe.client.getHost()).name || null;
        } catch (e) {
          if (e instanceof AgentRequestError && e.isUnauthorized) {
            return { ok: false, error: 'Token rejected.' };
          }
          return { ok: false, error: `No agent reachable at ${url}.` };
        }

        if (token) await setToken(id, token);
        primeToken(id, token ?? null);

        set((s) => ({
          nodes: [...s.nodes, { id, url, agentName, alias: null }],
          meta: { ...s.meta, [id]: DEFAULT_META },
        }));
        attach(id, url, token ?? null);

        return { ok: true, id };
      },

      removeNode: (id) => {
        detach(id);
        void deleteToken(id);
        set((s) => {
          const { [id]: _removed, ...meta } = s.meta;
          return {
            nodes: s.nodes.filter((n) => n.id !== id),
            meta,
            onlineNodes: countOnline(meta),
          };
        });
      },

      renameNode: (id, alias) =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id ? { ...n, alias: alias?.trim() || null } : n,
          ),
        })),

      updateNodeToken: async (id, token) => {
        await setToken(id, token);
        connections.get(id)?.setToken(token);
      },

      reconnect: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) return;
        detach(id);
        void getToken(id).then((token) => attach(node.id, node.url, token));
      },
    }),
    {
      name: 'cosmos-nodes',
      version: 1,
      partialize: (s) => ({ nodes: s.nodes }),
      migrate: (persisted) => {
        const nodes = (persisted as { nodes?: unknown[] } | null)?.nodes ?? [];
        return { nodes: nodes.map(migrateNode).filter((n): n is NodeConfig => !!n) };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Runs inside `create()`, so `useNodeStore` isn't initialised yet.
        // Seed through the draft and defer anything that touches the store.
        state.meta = Object.fromEntries(state.nodes.map((n) => [n.id, DEFAULT_META]));
        state.onlineNodes = 0;

        const nodes = state.nodes;
        queueMicrotask(() => {
          for (const node of nodes) {
            void getToken(node.id).then((token) => attach(node.id, node.url, token));
          }
        });
      },
    },
  ),
);

/** Display name for one node, re-rendering only when it changes. */
export function useNodeName(nodeId: string | null): string | null {
  return useNodeStore((s) => {
    const n = nodeId ? s.nodes.find((x) => x.id === nodeId) : undefined;
    return n ? nodeDisplayName(n) : null;
  });
}
