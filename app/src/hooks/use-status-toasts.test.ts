import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NodeStatus } from '@/api/connection';

type Listener = (nodeId: string, from: NodeStatus, to: NodeStatus) => void;
let listener: Listener = () => {};
const status: Record<string, NodeStatus> = {};
const oidc = { kind: 'oidc', issuer: 'https://auth.test/', client_id: 'cosmos', scopes: 'openid' };
const signedOut = new Set<string>();

vi.mock('@/stores/nodes', () => ({
  onNodeStatusChange: (fn: Listener) => {
    listener = fn;
    return () => {};
  },
  nodeDisplayName: (n: { agentName: string }) => n.agentName,
  useNodeStore: {
    getState: () => ({
      nodes: [
        { id: 'a', agentName: 'jupiter' },
        { id: 'b', agentName: 'saturn' },
      ],
    }),
  },
  getConnection: (id: string) => ({ getMeta: () => ({ status: status[id], auth: oidc }) }),
  getAllConnections: () => Object.keys(status).map((id) => ({ getMeta: () => ({ status: status[id], auth: oidc }) })),
}));
vi.mock('@/stores/auth', () => ({
  signIn: vi.fn(async () => {}),
  wasSignedOut: (issuer: string) => signedOut.has(issuer),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { useStatusToasts } from './use-status-toasts';

function move(id: string, from: NodeStatus, to: NodeStatus) {
  status[id] = to;
  listener(id, from, to);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedOut.clear();
  for (const k of Object.keys(status)) delete status[k];
  renderHook(() => useStatusToasts());
});

describe('useStatusToasts', () => {
  it('says a node dropped and came back', () => {
    move('a', 'connecting', 'online');
    move('a', 'online', 'offline');
    expect(toast.error).toHaveBeenCalledWith('jupiter is offline', { id: 'status-a' });
    move('a', 'offline', 'connecting');
    move('a', 'connecting', 'online');
    expect(toast.success).toHaveBeenCalledWith('jupiter is back online', { id: 'status-a' });
  });

  it("doesn't nag about signing in on launch: the account menu asks", () => {
    move('a', 'connecting', 'unauthorized');
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('says once per provider when a working sign-in stops', () => {
    move('a', 'connecting', 'online');
    move('b', 'connecting', 'online');
    move('a', 'online', 'connecting');
    move('a', 'connecting', 'unauthorized');
    move('b', 'online', 'connecting');
    move('b', 'connecting', 'unauthorized');
    expect(toast.warning).toHaveBeenCalledTimes(2);
    const [title, opts] = toast.warning.mock.calls[1];
    expect(title).toBe('Your sign-in expired');
    expect(opts).toMatchObject({ id: 'signin-https://auth.test/', description: 'Sign in again to see 2 nodes.' });
    expect(opts.action.label).toBe('Sign in');

    move('a', 'unauthorized', 'online');
    expect(toast.dismiss).toHaveBeenCalledWith('signin-https://auth.test/');
  });

  it('stays quiet after signing out on purpose', () => {
    move('a', 'connecting', 'online');
    signedOut.add(oidc.issuer);
    move('a', 'online', 'connecting');
    move('a', 'connecting', 'unauthorized');
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
