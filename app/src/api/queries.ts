import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { HostInfo } from '@/generated/HostInfo';
import { useNodeStore } from '../stores/nodes';

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
