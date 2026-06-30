import { create } from 'zustand';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { ServiceInfo, deriveServices } from '@/lib/services';

interface ContainersStore {
  nodeContainers: Record<string, ContainerInfo[]>;
  services: ServiceInfo[];
  setNodeContainers: (nodeId: string, containers: ContainerInfo[]) => void;
  removeNode: (nodeId: string) => void;
}

export const useContainersStore = create<ContainersStore>((set) => ({
  nodeContainers: {},
  services: [],

  setNodeContainers: (nodeId, containers) =>
    set((s) => {
      const nodeContainers = { ...s.nodeContainers, [nodeId]: containers };
      return { nodeContainers, services: deriveServices(nodeContainers) };
    }),

  removeNode: (nodeId) =>
    set((s) => {
      const { [nodeId]: _, ...rest } = s.nodeContainers;
      return { nodeContainers: rest, services: deriveServices(rest) };
    }),
}));