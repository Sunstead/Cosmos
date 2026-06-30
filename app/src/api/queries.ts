import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { HostInfo } from '@/generated/HostInfo';
import { useNodeStore } from '../stores/nodes';
import { useContainersStore } from '../stores/containers';

export function useHostInfo(nodeId: string | null) {
  const getClient = useNodeStore((s) => s.getClient);
  const cached = useNodeStore((s) =>
    nodeId ? (s.nodeHostInfo[nodeId] ?? null) : null,
  );
  const client = nodeId ? getClient(nodeId) : null;
  const [data, setData] = useState<HostInfo | null>(cached);

  useEffect(() => {
    if (cached && !data) setData(cached);
  }, [cached]);

  useEffect(() => {
    if (!client) {
      setData(null);
      return;
    }
    return client.streamHost((info) => setData(info));
  }, [client]);

  return { data, isLoading: data === null };
}

export function useContainers(nodeId: string | null) {
  const getClient = useNodeStore((s) => s.getClient);
  const client = nodeId ? getClient(nodeId) : null;
  return useQuery({
    queryKey: ['containers', nodeId],
    queryFn: () => client!.getContainers(),
    enabled: !!client,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

// Fetches containers for all known nodes and keeps the containers store in sync.
// Mount once at the app/layout level — does not render anything.
export function useAllContainersSync() {
  const nodes = useNodeStore((s) => s.nodes);
  const getClient = useNodeStore((s) => s.getClient);
  const setNodeContainers = useContainersStore((s) => s.setNodeContainers);
  const removeNode = useContainersStore((s) => s.removeNode);

  // Remove store entries for nodes that have been deleted
  const prevNodeIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = new Set(nodes.map((n) => n.id));
    for (const id of prevNodeIds.current) {
      if (!current.has(id)) removeNode(id);
    }
    prevNodeIds.current = current;
  }, [nodes]);

  useQueries({
    queries: nodes.map((node) => ({
      queryKey: ['containers', node.id],
      queryFn: async () => {
        const client = getClient(node.id);
        if (!client) throw new Error(`No client for node ${node.id}`);
        const result = await client.getContainers();
        setNodeContainers(node.id, result.containers);
        return result;
      },
      enabled: !!getClient(node.id),
      refetchInterval: 5_000,
      refetchIntervalInBackground: false,
    })),
  });
}
