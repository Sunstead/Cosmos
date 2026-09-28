import { useEffect } from 'react';
import { toast } from 'sonner';
import { getAllConnections, getConnection, nodeDisplayName, onNodeStatusChange, useNodeStore } from '@/stores/nodes';
import { signIn, wasSignedOut } from '@/stores/auth';
import { plural } from '@/lib/format';

/**
 * Toasts when a node drops offline or comes back, and when a sign-in that was
 * working stops. While a node is down its status alternates between offline
 * and connecting (each retry), so "back" is remembered from the drop rather
 * than read from the transition.
 *
 * A node that needs a sign-in on launch gets no toast: the account menu at
 * the foot of the sidebar asks. Nor does signing out on purpose.
 */
export function useStatusToasts() {
  useEffect(() => {
    const dropped = new Set<string>();
    const worked = new Set<string>();
    return onNodeStatusChange((nodeId, from, to) => {
      const node = useNodeStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const name = nodeDisplayName(node);

      if (to === 'online') {
        worked.add(nodeId);
        const auth = getConnection(nodeId)?.getMeta().auth;
        if (auth?.kind === 'oidc') toast.dismiss(`signin-${auth.issuer}`);
      }
      if (from === 'online' && to === 'offline') {
        dropped.add(nodeId);
        toast.error(`${name} is offline`, { id: `status-${nodeId}` });
      } else if (to === 'online' && dropped.delete(nodeId)) {
        toast.success(`${name} is back online`, { id: `status-${nodeId}` });
      } else if (to === 'unauthorized') {
        dropped.delete(nodeId);
        toast.dismiss(`status-${nodeId}`);
        const auth = getConnection(nodeId)?.getMeta().auth;
        if (auth?.kind !== 'oidc' || !worked.has(nodeId) || wasSignedOut(auth.issuer)) return;
        // One toast per provider, however many nodes share it.
        const waiting = getAllConnections().filter((c) => {
          const m = c.getMeta();
          return m.status === 'unauthorized' && m.auth?.kind === 'oidc' && m.auth.issuer === auth.issuer;
        }).length;
        toast.warning('Your sign-in expired', {
          id: `signin-${auth.issuer}`,
          description: waiting > 1 ? `Sign in again to see ${plural(waiting, 'node')}.` : `Sign in again to see ${name}.`,
          duration: Infinity,
          action: {
            label: 'Sign in',
            onClick: () =>
              void signIn(auth, { returnTo: window.location.pathname }).catch((e: unknown) =>
                toast.error('Sign-in failed', { description: e instanceof Error ? e.message : undefined }),
              ),
          },
        });
      }
    });
  }, []);
}
