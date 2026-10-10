import { create } from 'zustand';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { deriveNodeServices, groupServices, ServiceGroup, ServiceInfo } from '@/lib/services';

interface ContainersStore {
  nodeContainers: Record<string, ContainerInfo[]>;
  /** Services per node, so one node's update doesn't recompute the rest. */
  nodeServices: Record<string, ServiceInfo[]>;
  /** Flattened across nodes, recomputed only when a node's slice changes. */
  services: ServiceInfo[];
  /** `services` grouped by key across nodes: one entry per service. */
  groups: ServiceGroup[];
  /** Nodes whose Docker isn't answering; their lists are the last known. */
  dockerDown: Record<string, true>;
  setNodeContainers: (nodeId: string, containers: ContainerInfo[], dockerUnavailable?: boolean) => void;
  removeNode: (nodeId: string) => void;
}

function withFlag(flags: Record<string, true>, nodeId: string, on: boolean): Record<string, true> {
  const { [nodeId]: _was, ...rest } = flags;
  return on ? { ...rest, [nodeId]: true } : rest;
}

const flatten = (byNode: Record<string, ServiceInfo[]>): ServiceInfo[] =>
  Object.values(byNode)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name));

const derived = (nodeServices: Record<string, ServiceInfo[]>) => {
  const services = flatten(nodeServices);
  return { nodeServices, services, groups: groupServices(services) };
};

export const useContainersStore = create<ContainersStore>((set) => ({
  nodeContainers: {},
  nodeServices: {},
  services: [],
  groups: [],
  dockerDown: {},

  setNodeContainers: (nodeId, containers, dockerUnavailable = false) =>
    set((s) => {
      const nodeServices = {
        ...s.nodeServices,
        [nodeId]: deriveNodeServices(nodeId, containers),
      };
      return {
        nodeContainers: { ...s.nodeContainers, [nodeId]: containers },
        ...derived(nodeServices),
        // Replaced only on a change, so pages reading it don't re-render per sample.
        dockerDown: !!s.dockerDown[nodeId] === dockerUnavailable ? s.dockerDown : withFlag(s.dockerDown, nodeId, dockerUnavailable),
      };
    }),

  removeNode: (nodeId) =>
    set((s) => {
      const { [nodeId]: _containers, ...nodeContainers } = s.nodeContainers;
      const { [nodeId]: _services, ...nodeServices } = s.nodeServices;
      return {
        nodeContainers,
        ...derived(nodeServices),
        dockerDown: withFlag(s.dockerDown, nodeId, false),
      };
    }),
}));
