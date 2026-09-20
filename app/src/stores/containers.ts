import { create } from 'zustand';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { deriveNodeServices, ServiceInfo } from '@/lib/services';

interface ContainersStore {
  nodeContainers: Record<string, ContainerInfo[]>;
  /** Services per node, so one node's update doesn't recompute the rest. */
  nodeServices: Record<string, ServiceInfo[]>;
  /** Flattened across nodes, recomputed only when a node's slice changes. */
  services: ServiceInfo[];
  setNodeContainers: (nodeId: string, containers: ContainerInfo[]) => void;
  removeNode: (nodeId: string) => void;
}

const flatten = (byNode: Record<string, ServiceInfo[]>): ServiceInfo[] =>
  Object.values(byNode)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name));

export const useContainersStore = create<ContainersStore>((set) => ({
  nodeContainers: {},
  nodeServices: {},
  services: [],

  setNodeContainers: (nodeId, containers) =>
    set((s) => {
      const nodeServices = {
        ...s.nodeServices,
        [nodeId]: deriveNodeServices(nodeId, containers),
      };
      return {
        nodeContainers: { ...s.nodeContainers, [nodeId]: containers },
        nodeServices,
        services: flatten(nodeServices),
      };
    }),

  removeNode: (nodeId) =>
    set((s) => {
      const { [nodeId]: _containers, ...nodeContainers } = s.nodeContainers;
      const { [nodeId]: _services, ...nodeServices } = s.nodeServices;
      return { nodeContainers, nodeServices, services: flatten(nodeServices) };
    }),
}));
