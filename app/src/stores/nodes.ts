import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AgentClient } from '../api/client';

export interface NodeConfig {
  id: string;
  url: string;
  name: string;
}

interface NodeStore {
  nodes: NodeConfig[];
  activeNodeId: string | null;
  clients: Record<string, AgentClient>;
  addNode: (url: string) => Promise<void>;
  removeNode: (id: string) => void;
  setActiveNode: (id: string) => void;
  getClient: (id: string) => AgentClient | null;
}

export const useNodeStore = create<NodeStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      activeNodeId: null,
      clients: {},

      addNode: async (url: string) => {
        const id = crypto.randomUUID();
        const client = new AgentClient(url);

        set((s) => ({
          nodes: [...s.nodes, { id, url, name: url }],
          activeNodeId: s.activeNodeId ?? id,
          clients: { ...s.clients, [id]: client },
        }));

        // Fetch the real display name from the agent.
        try {
          const host = await client.getHost();
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.id === id ? { ...n, name: host.name } : n,
            ),
          }));
        } catch {
          // Name stays as url until the agent is reachable.
        }
      },

      removeNode: (id) =>
        set((s) => {
          const { [id]: _, ...remainingClients } = s.clients;
          return {
            nodes: s.nodes.filter((n) => n.id !== id),
            activeNodeId: s.activeNodeId === id ? null : s.activeNodeId,
            clients: remainingClients,
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
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const clients: Record<string, AgentClient> = {};
        for (const node of state.nodes) {
          clients[node.id] = new AgentClient(node.url);
        }
        state.clients = clients;
      },
    },
  ),
);
