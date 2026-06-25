import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AgentClient } from '../api/client';

export interface NodeConfig {
  id: string;
  url: string;
  name: string;
}

export type NodeStatus = 'loading' | 'online' | 'offline';

interface NodeStore {
  nodes: NodeConfig[];
  activeNodeId: string | null;
  clients: Record<string, AgentClient>;
  nodeStatuses: Record<string, NodeStatus>;
  onlineNodes: number;
  addNode: (url: string) => Promise<void>;
  removeNode: (id: string) => void;
  setActiveNode: (id: string) => void;
  getClient: (id: string) => AgentClient | null;
}

const countOnline = (statuses: Record<string, NodeStatus>) =>
  Object.values(statuses).filter((s) => s === 'online').length;

export const useNodeStore = create<NodeStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      activeNodeId: null,
      clients: {},
      nodeStatuses: {},
      onlineNodes: 0,

      addNode: async (url: string) => {
        const id = crypto.randomUUID();
        const client = new AgentClient(url);

        set((s) => {
          const nodeStatuses = {
            ...s.nodeStatuses,
            [id]: 'loading' as NodeStatus,
          };
          return {
            nodes: [...s.nodes, { id, url, name: url }],
            activeNodeId: s.activeNodeId ?? id,
            clients: { ...s.clients, [id]: client },
            nodeStatuses,
            onlineNodes: countOnline(nodeStatuses),
          };
        });

        try {
          const host = await client.getHost();
          set((s) => {
            const nodeStatuses = {
              ...s.nodeStatuses,
              [id]: 'online' as NodeStatus,
            };
            return {
              nodes: s.nodes.map((n) =>
                n.id === id ? { ...n, name: host.name } : n,
              ),
              nodeStatuses,
              onlineNodes: countOnline(nodeStatuses),
            };
          });
        } catch {
          set((s) => {
            const nodeStatuses = {
              ...s.nodeStatuses,
              [id]: 'offline' as NodeStatus,
            };
            return { nodeStatuses, onlineNodes: countOnline(nodeStatuses) };
          });
        }
      },

      removeNode: (id) =>
        set((s) => {
          const { [id]: _c, ...remainingClients } = s.clients;
          const { [id]: _s, ...remainingStatuses } = s.nodeStatuses;
          return {
            nodes: s.nodes.filter((n) => n.id !== id),
            activeNodeId: s.activeNodeId === id ? null : s.activeNodeId,
            clients: remainingClients,
            nodeStatuses: remainingStatuses,
            onlineNodes: countOnline(remainingStatuses),
          };
        }),

      setActiveNode: (id) => set({ activeNodeId: id }),

      getClient: (id) => get().clients[id] ?? null,
    }),
    {
      name: 'cosmos-nodes',
      partialize: (s) => ({
        nodes: s.nodes,
        activeNodeId: s.activeNodeId,
      }),
      onRehydrateStorage: () => async (state) => {
        if (!state) return;

        const clients: Record<string, AgentClient> = {};
        const nodeStatuses: Record<string, NodeStatus> = {};

        for (const node of state.nodes) {
          clients[node.id] = new AgentClient(node.url);
          nodeStatuses[node.id] = 'loading';
        }

        state.clients = clients;
        state.nodeStatuses = nodeStatuses;
        state.onlineNodes = 0;

        // Re-verify every node in parallel
        await Promise.allSettled(
          state.nodes.map(async (node) => {
            try {
              const host = await clients[node.id].getHost();
              useNodeStore.setState((s) => {
                const updated = {
                  ...s.nodeStatuses,
                  [node.id]: 'online' as NodeStatus,
                };
                return {
                  nodeStatuses: updated,
                  onlineNodes: countOnline(updated),
                  nodes: s.nodes.map((n) =>
                    n.id === node.id ? { ...n, name: host.name } : n,
                  ),
                };
              });
            } catch {
              useNodeStore.setState((s) => {
                const updated = {
                  ...s.nodeStatuses,
                  [node.id]: 'offline' as NodeStatus,
                };
                return {
                  nodeStatuses: updated,
                  onlineNodes: countOnline(updated),
                };
              });
            }
          }),
        );
      },
    },
  ),
);
