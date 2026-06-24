import { useQuery } from '@tanstack/react-query';
import { useNodeStore } from '../stores/nodes';

// How often each data type refreshes
const INTERVALS = {
  host: 1_000, // Hardware metrics interval
  containers: 5_000, // Containers
} as const;

export function useHostInfo(nodeId: string | null) {
  const getClient = useNodeStore((s) => s.getClient);
  const client = nodeId ? getClient(nodeId) : null;

  return useQuery({
    queryKey: ['host', nodeId],
    queryFn: () => client!.getHost(),
    enabled: !!client,
    refetchInterval: INTERVALS.host,
    refetchIntervalInBackground: false, // Pause when tab is hidden
  });
}

export function useContainers(nodeId: string | null) {
  const getClient = useNodeStore((s) => s.getClient);
  const client = nodeId ? getClient(nodeId) : null;

  return useQuery({
    queryKey: ['containers', nodeId],
    queryFn: () => client!.getContainers(),
    enabled: !!client,
    refetchInterval: INTERVALS.containers,
    refetchIntervalInBackground: false,
  });
}
