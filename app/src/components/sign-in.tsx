import { LogIn, LogOut, RefreshCw, ServerOff, UserRound } from 'lucide-react';
import { OidcAuthInfo } from '@/api/connection';
import { useNodeName, useNodeStore } from '@/stores/nodes';
import { useNodeMeta } from '@/api/queries';
import { useAccounts } from '@/hooks/use-accounts';
import { providerHost, roleLabel } from '@/lib/accounts';
import { plural } from '@/lib/format';
import { signOutAndSay, useNodeSignIn, useSignIn } from '@/lib/sign-in';
import { Button } from '@sunstead/ui/components/button';
import { Badge } from '@sunstead/ui/components/badge';
import { EmptyState } from './empty-state';
import { UserAvatar } from './user-avatar';

export function SignInButton({
  auth,
  size = 'sm',
  variant = 'default',
}: {
  auth: OidcAuthInfo;
  size?: 'sm' | 'default';
  variant?: 'default' | 'outline';
}) {
  const { start, busy } = useSignIn();
  return (
    <Button size={size} variant={variant} disabled={busy} onClick={() => void start(auth)}>
      <LogIn /> Sign in
    </Button>
  );
}

/**
 * What gets a node that isn't showing data going again: a sign-in when it
 * wants one (retrying won't help), otherwise a retry.
 */
export function NodeRecoveryButton({ nodeId, size = 'default' }: { nodeId: string; size?: 'sm' | 'default' }) {
  const reconnect = useNodeStore((s) => s.reconnect);
  const auth = useNodeSignIn(nodeId);
  if (auth) return <SignInButton auth={auth} size={size} />;
  return (
    <Button variant='outline' size={size} onClick={() => reconnect(nodeId)}>
      <RefreshCw /> Retry
    </Button>
  );
}

/** A page's node that won't answer until it's retried or signed in to. */
export function NodeUnavailable({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  const name = useNodeName(nodeId) ?? 'This node';
  const signIn = meta?.status === 'unauthorized';
  return (
    <EmptyState
      size='page'
      icon={ServerOff}
      title={signIn ? `Sign in to see ${name}` : `${name} is offline`}
      description={signIn ? undefined : (meta?.error ?? undefined)}
      action={<NodeRecoveryButton nodeId={nodeId} />}
    />
  );
}

/**
 * Who you're signed in as, per provider, and a way in or out. Providers come
 * from the nodes' agents, so a provider no node uses doesn't appear.
 */
export function AccountList() {
  const accounts = useAccounts();
  const { start, busy } = useSignIn();

  if (accounts.length === 0) {
    return <EmptyState size='inline' icon={UserRound} title='No node asks for a sign-in' />;
  }

  return (
    <>
      {accounts.map((a) => {
        const s = a.session;
        const role = roleLabel(a);
        const name = s ? (s.name ?? s.username ?? 'Signed in') : 'Not signed in';
        return (
          <div key={a.auth.issuer} className='flex items-center gap-3 px-4 py-3 text-sm'>
            <UserAvatar who={{ name, picture: s?.picture ?? null, known: !!s }} />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='truncate font-medium'>{name}</span>
                {s && role && (
                  <Badge variant='secondary' className='text-2xs'>
                    {role}
                  </Badge>
                )}
              </div>
              <div className='truncate text-xs text-muted-foreground'>
                {[s?.email ?? (s?.username !== name ? s?.username : null), providerHost(a.auth.issuer), plural(a.nodes.length, 'node')]
                  .filter(Boolean)
                  .join(', ')}
              </div>
            </div>
            {s ? (
              <Button variant='outline' size='sm' onClick={() => void signOutAndSay(a.auth)}>
                <LogOut /> Sign out
              </Button>
            ) : (
              <Button size='sm' disabled={busy} onClick={() => void start(a.auth)}>
                <LogIn /> Sign in
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
