import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NodeConnection, NodeMeta, NodeStatus, OidcAuthInfo } from '@/api/connection';
import { AgentRequestError, LEGACY_CAPABILITIES } from '@/api/client';
import { normalizeAgentUrl } from '@/lib/agent-url';
import { getAccessToken, ProviderUnreachable, useAuthStore } from './auth';
import { sumDisk, getMemUsagePct } from '@/lib/node-metrics';
import { clearNodeSeries, pushSample, resetNodeSeries } from './metrics-history';
import { useContainersStore } from './containers';
import { useVolumesStore } from './volumes';
import { useEventsStore } from './events';
import { Event } from '@/generated/Event';

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

type AddResult =
  | { ok: true; id: string }
  /** `signIn`: the agent is fine, we just need to sign in to its provider first. */
  | { ok: false; error: string; signIn?: OidcAuthInfo };

interface NodeStore {
  nodes: NodeConfig[];
  /** Live connection state per node. Not persisted. */
  meta: Record<string, NodeMeta>;
  onlineNodes: number;

  addNode: (url: string) => Promise<AddResult>;
  removeNode: (id: string) => void;
  /** Pass null or an empty string to fall back to the agent's name. */
  renameNode: (id: string, alias: string | null) => void;
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
  principal: null,
  auth: null,
  agentVersion: null,
  description: null,
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

/** Events that are news: not the history loaded on connect. */
type NewEventsListener = (nodeId: string, events: Event[]) => void;
const newEventListeners = new Set<NewEventsListener>();

export function onNewEvents(fn: NewEventsListener): () => void {
  newEventListeners.add(fn);
  return () => newEventListeners.delete(fn);
}

function attach(nodeId: string, url: string): NodeConnection {
  const conn = new NodeConnection(nodeId, url, getAccessToken);
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

  conn.onContainers(({ containers, dockerUnavailable }) => {
    useContainersStore.getState().setNodeContainers(nodeId, containers, dockerUnavailable);
  });

  conn.onVolumes((volumes) => {
    useVolumesStore.getState().setNodeVolumes(nodeId, volumes);
  });

  conn.onEvents((update) => {
    useEventsStore.getState().apply(nodeId, update);
    if (!update.initial && update.events.length) {
      for (const fn of newEventListeners) fn(nodeId, update.events);
    }
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
  useEventsStore.getState().removeNode(nodeId);
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

      addNode: async (rawUrl) => {
        const url = normalizeAgentUrl(rawUrl);
        if (!url) return { ok: false, error: 'Enter a host or URL.' };
        if (get().nodes.some((n) => n.url === url)) {
          return { ok: false, error: 'This node is already added.' };
        }

        const id = crypto.randomUUID();

        // Probe first so a bad address or sign-in is reported, not saved.
        const probe = new NodeConnection(id, url);
        let agentName: string | null = null;
        try {
          const info = await probe.client.getInfo();
          if (info.auth?.kind === 'oidc') {
            const token = await getAccessToken(info.auth);
            if (!token) return { ok: false, error: 'Sign in to add this node.', signIn: info.auth };
            probe.client.setToken(token);
          } else if (info.auth_required) {
            return {
              ok: false,
              error: 'This agent is older than 0.3 and uses a shared token. Update it first.',
            };
          }
          agentName = (await probe.client.getHost()).name || null;
        } catch (e) {
          if (e instanceof AgentRequestError && e.isUnauthorized) {
            return { ok: false, error: 'Signed in, but this agent did not accept it.' };
          }
          if (e instanceof ProviderUnreachable) {
            return { ok: false, error: `${e.message}. Try again in a moment.` };
          }
          return { ok: false, error: `No agent reachable at ${url}.` };
        }

        set((s) => ({
          nodes: [...s.nodes, { id, url, agentName, alias: null }],
          meta: { ...s.meta, [id]: DEFAULT_META },
        }));
        attach(id, url);

        return { ok: true, id };
      },

      removeNode: (id) => {
        detach(id);
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

      reconnect: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) return;
        detach(id);
        attach(node.id, node.url);
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
          for (const node of nodes) attach(node.id, node.url);
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

/**
 * Every node that trusts a provider shares its session. A new sign-in may
 * unlock the nodes waiting on it; a sign-out (or a revoked refresh token)
 * drops the streams still open on the old token, so those nodes ask for a
 * sign-in at once instead of carrying on until they next reconnect.
 */
useAuthStore.subscribe((state, prev) => {
  const added = Object.keys(state.sessions).filter((issuer) => !prev.sessions[issuer]);
  const removed = Object.keys(prev.sessions).filter((issuer) => !state.sessions[issuer]);
  if (added.length === 0 && removed.length === 0) return;
  for (const conn of connections.values()) {
    const meta = conn.getMeta();
    if (meta.auth?.kind !== 'oidc') continue;
    const issuer = meta.auth.issuer;
    if ((meta.status === 'unauthorized' && added.includes(issuer)) || (meta.status !== 'unauthorized' && removed.includes(issuer))) {
      conn.retryNow();
    }
  }
});
