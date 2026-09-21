import { useEffect } from 'react';
import { toast } from 'sonner';
import { nodeDisplayName, onNodeStatusChange, useNodeStore } from '@/stores/nodes';

/** Toasts when a node drops offline or comes back. */
export function useStatusToasts() {
  useEffect(
    () =>
      onNodeStatusChange((nodeId, from, to) => {
        const node = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
        if (!node) return;
        const name = nodeDisplayName(node);

        if (from === 'online' && to === 'offline') {
          toast.error(`${name} is offline`, { id: `status-${nodeId}` });
        } else if (from === 'offline' && to === 'online') {
          toast.success(`${name} is back online`, { id: `status-${nodeId}` });
        } else if (to === 'unauthorized') {
          toast.warning(`${name} needs a token`, { id: `status-${nodeId}` });
        }
      }),
    [],
  );
}
