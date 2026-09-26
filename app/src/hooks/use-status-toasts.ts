import { useEffect } from 'react';
import { toast } from 'sonner';
import { nodeDisplayName, onNodeStatusChange, useNodeStore } from '@/stores/nodes';

/**
 * Toasts when a node drops offline or comes back. While it's down the status
 * alternates between offline and connecting (each retry), so "back" is
 * remembered from the drop rather than read from the transition.
 */
export function useStatusToasts() {
  useEffect(() => {
    const dropped = new Set<string>();
    return onNodeStatusChange((nodeId, from, to) => {
      const node = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const name = nodeDisplayName(node);

      if (from === 'online' && to === 'offline') {
        dropped.add(nodeId);
        toast.error(`${name} is offline`, { id: `status-${nodeId}` });
      } else if (to === 'online' && dropped.delete(nodeId)) {
        toast.success(`${name} is back online`, { id: `status-${nodeId}` });
      } else if (to === 'unauthorized') {
        dropped.delete(nodeId);
        toast.warning(`${name} needs a token`, { id: `status-${nodeId}` });
      }
    });
  }, []);
}
