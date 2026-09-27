import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useContainersStore } from '@/stores/containers';
import { nodeDisplayName, useNodeStore } from '@/stores/nodes';

/**
 * Says which nodes' Docker isn't answering, above a list of their
 * containers: an empty or unchanging list there isn't the truth. `nodeId`
 * narrows it to one node.
 */
export function DockerDownNote({ nodeId }: { nodeId?: string }) {
  const down = useContainersStore((s) => s.dockerDown);
  const nodes = useNodeStore((s) => s.nodes);
  const names = nodes
    .filter((n) => down[n.id] && (!nodeId || n.id === nodeId))
    .map(nodeDisplayName);
  if (names.length === 0) return null;

  return (
    <Alert className='border-warning/40'>
      <TriangleAlert className='text-warning' />
      <AlertTitle>{`Docker isn't answering on ${names.join(', ')}`}</AlertTitle>
      <AlertDescription>
        {names.length === 1 ? 'Its containers are' : 'Their containers are'} shown as Docker last reported them.
      </AlertDescription>
    </Alert>
  );
}
