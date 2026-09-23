import { useEffect, useState } from 'react';
import { useNodeStore } from '@/stores/nodes';

/**
 * How long a page shows skeletons for a node's first data before it gives up
 * and renders what it has. A node that connects but never sends (an old agent,
 * an endpoint that keeps failing) must not leave a page loading forever.
 */
export const AWAIT_MS = 8_000;

/**
 * True while some node that is connecting or online has not delivered its
 * first `byNode` entry yet, so the page should show skeletons rather than an
 * empty state that isn't true. Offline and signed-out nodes are never
 * awaited: they won't send anything until that changes.
 *
 * `only` narrows it to one node, for pages scoped to a single node.
 */
export function useAwaiting(byNode: Record<string, unknown>, only?: string | null): boolean {
  const waiting = useNodeStore((s) =>
    s.nodes.some((n) => {
      if (only !== undefined && n.id !== only) return false;
      const status = s.meta[n.id]?.status ?? 'connecting';
      return (status === 'connecting' || status === 'online') && byNode[n.id] === undefined;
    }),
  );

  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setExpired(true), AWAIT_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  return waiting && !expired;
}
