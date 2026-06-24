import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AgentClient } from '../api/client';

export interface NodeConfig {
  id: string;
  url: string;
  name: string; // populated from agent after first contact
}

interface NodeStore {
  nodes: NodeConfig[];
  activeNodeId: string | null;
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

      addNode: async (url: string) => {
        const id = crypto.randomUUID();
        // add immediately with url as placeholder name
        set((s) => ({
          nodes: [...s.nodes, { id, url, name: url }],
          activeNodeId: s.activeNodeId ?? id,
        }));
        // fetch real name from agent
        try {
          const client = new AgentClient(url);
          const host = await client.getHost();
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.id === id ? { ...n, name: host.name } : n,
            ),
          }));
        } catch {
          // name stays as url until agent is reachable
        }
      },

      removeNode: (id) =>
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== id),
          activeNodeId: s.activeNodeId === id ? null : s.activeNodeId,
        })),

      setActiveNode: (id) => set({ activeNodeId: id }),

      getClient: (id) => {
        const node = get().nodes.find((n) => n.id === id);
        return node ? new AgentClient(node.url) : null;
      },
    }),
    { name: 'cosmos-nodes' },
  ),
);
