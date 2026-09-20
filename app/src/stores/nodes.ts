import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NodeConnection, NodeMeta, NodeStatus } from '@/api/connection';
import { LEGACY_CAPABILITIES } from '@/api/client';
import { normalizeAgentUrl } from '@/lib/agent-url';
import { getToken, deleteToken, primeToken, setToken } from '@/lib/secrets';
import { clearNodeSeries, pushSample, resetNodeSeries } from './metrics-history';
import { useContainersStore } from './containers';
import { useVolumesStore } from './volumes';
import { sumDisk, getMemUsagePct } from '@/lib/node-metrics';

export interface NodeConfig {
  id: string;
  url: string;
  name: string;
}

export type { NodeStatus };

interface NodeStore {
  nodes: NodeConfig[];
  /** Live connection state, keyed by node id. Never persisted. */
  meta: Record<string, NodeMeta>;
  onlineNodes: number;

  addNode: (url: string, token?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeNode: (id: string) => void;
  renameNode: (id: string, name: string) => void;
  updateNodeToken: (id: string, token: string) => Promise<void>;
  reconnect: (id: string) => void;
}

/**
 * Connections live outside the store. They hold EventSources and timers, which
 * are not state React should diff — the store holds only what components
 * render.
 */
const connections = new Map<string, NodeConnection>();

export function getConnection(nodeId: string): NodeConnection | null {
  return connections.get(nodeId) ?? null;
}

export function getAllConnections(): NodeConnection[] {
  return [...connections.values()];
}

const DEFAULT_META: NodeMeta = {
  status: 'connecting',
  capabilities: LEGACY_CAPABILITIES,
  agentVersion: null,
  apiVersion: 0,
  error: null,
};

const countOnline = (meta: Record<string, NodeMeta>) =>
  Object.values(meta).filter((m) => m.status === 'online').length;

/**
 * Wires one connection into the stores and starts it.
 *
 * Node status is driven by real stream events here. Previously it was only
 * written once at connect time, so a node that died later stayed "online"
 * forever and the Nodes page's counters were permanently stale.
 */
function attach(node: NodeConfig, token: string | null): NodeConnection {
  const conn = new NodeConnection(node.id, node.url, token);
  connections.set(node.id, conn);

  conn.onMeta((meta) => {
    useNodeStore.setState((s) => {
      const next = { ...s.meta, [node.id]: meta };
      return { meta: next, onlineNodes: countOnline(next) };
    });
  });

  conn.onHost((host) => {
    // Raw units in, matching the wire format. Percentages are derived because
    // a ratio is what a sparkline wants; byte rates stay raw.
    pushSample(node.id, {
      cpu: host.cpu_pct,
      ram: getMemUsagePct(host),
      netRx: host.net_rx_bps,
      netTx: host.net_tx_bps,
      diskRead: sumDisk(host, 'read_bps'),
      diskWrite: sumDisk(host, 'write_bps'),
    });

    // The node's display name comes from the agent, not from the URL.
    if (host.name && host.name !== node.name) {
      useNodeStore.setState((s) => ({
        nodes: s.nodes.map((n) => (n.id === node.id ? { ...n, name: host.name } : n)),
      }));
    }
  });

  conn.onContainers((containers) => {
    useContainersStore.getState().setNodeContainers(node.id, containers);
  });

  conn.onVolumes((volumes) => {
    useVolumesStore.getState().setNodeVolumes(node.id, volumes);
  });

  // The agent restarted: its rate deltas restart from zero and the old points
  // don't join up with the new ones.
  conn.onReset(() => resetNodeSeries(node.id));

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

export const useNodeStore = create<NodeStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      meta: {},
      onlineNodes: 0,

      addNode: async (rawUrl, token) => {
        const url = normalizeAgentUrl(rawUrl);
        if (!url) {
          return { ok: false, error: 'That does not look like a host or URL.' };
        }
        if (get().nodes.some((n) => n.url === url)) {
          return { ok: false, error: 'That node has already been added.' };
        }

        const id = crypto.randomUUID();

        // Verify before committing, so the dialog can report a bad address or
        // a missing token instead of silently creating a dead node — which is
        // what the old fire-and-forget version did.
        const probe = new NodeConnection(id, url, token ?? null);
        try {
          const info = await probe.client.getInfo();
          if (info.auth_required && !token) {
            return { ok: false, error: 'This agent requires a token.' };
          }
          await probe.client.getHost();
        } catch (e) {
          const message =
            e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 401
              ? 'The token was rejected by this agent.'
              : `Could not reach an agent at ${url}.`;
          return { ok: false, error: message };
        }

        if (token) await setToken(id, token);
        primeToken(id, token ?? null);

        const node: NodeConfig = { id, url, name: url };
        set((s) => ({
          nodes: [...s.nodes, node],
          meta: { ...s.meta, [id]: DEFAULT_META },
        }));
        attach(node, token ?? null);

        return { ok: true };
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

      renameNode: (id, name) =>
        set((s) => ({
          nodes: s.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
        })),

      updateNodeToken: async (id, token) => {
        await setToken(id, token);
        connections.get(id)?.setToken(token);
      },

      reconnect: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) return;
        detach(id);
        void getToken(id).then((token) => attach(node, token));
      },
    }),
    {
      name: 'cosmos-nodes',
      // Only the identity of each node is persisted. Tokens live in the
      // keychain, and connection state is meaningless across restarts.
      partialize: (s) => ({ nodes: s.nodes }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Seed via the rehydrating draft, not `useNodeStore.setState`: this
        // runs *during* `create()`, so the `useNodeStore` binding is still in
        // its temporal dead zone and touching it throws.
        state.meta = Object.fromEntries(state.nodes.map((n) => [n.id, DEFAULT_META]));
        state.onlineNodes = 0;

        const nodes = state.nodes;

        // Deferred for the same reason — `attach` publishes connection state
        // through the store as soon as it subscribes.
        queueMicrotask(() => {
          // Tokens come from the keychain, which is async; connect each node
          // as soon as its own token resolves rather than waiting for all.
          for (const node of nodes) {
            void getToken(node.id).then((token) => attach(node, token));
          }
        });
      },
    },
  ),
);
