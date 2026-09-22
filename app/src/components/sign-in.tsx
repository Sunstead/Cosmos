import { LogIn, LogOut, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { OidcAuthInfo } from '@/api/connection';
import { signOut, useAuthStore } from '@/stores/auth';
import { useNodeStore } from '@/stores/nodes';
import { useSignIn } from '@/lib/sign-in';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { EmptyState } from './empty-state';

export function SignInButton({ auth, size = 'sm' }: { auth: OidcAuthInfo; size?: 'sm' | 'default' }) {
  const { start, busy } = useSignIn();
  return (
    <Button size={size} disabled={busy} onClick={() => void start(auth)}>
      <LogIn /> Sign in
    </Button>
  );
}

function providerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}

/**
 * Who you're signed in as, per provider, and a way out. Providers come from
 * the nodes' agents, so a provider no node uses doesn't appear.
 */
export function AccountList() {
  const sessions = useAuthStore((s) => s.sessions);
  const metas = useNodeStore((s) => s.meta);
  const { start, busy } = useSignIn();

  const providers = new Map<string, OidcAuthInfo>();
  const admin = new Map<string, boolean>();
  for (const m of Object.values(metas)) {
    if (m.auth?.kind !== 'oidc') continue;
    providers.set(m.auth.issuer, m.auth);
    if (m.principal) admin.set(m.auth.issuer, (admin.get(m.auth.issuer) ?? false) || m.principal.admin);
  }

  if (providers.size === 0) {
    return <EmptyState size='inline' icon={UserRound} title='No node asks for a sign-in' />;
  }

  return (
    <>
      {[...providers.values()].map((auth) => {
        const session = sessions[auth.issuer];
        return (
          <div key={auth.issuer} className='flex items-center gap-3 px-4 py-3 text-sm'>
            <UserRound className='size-4 text-muted-foreground' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2'>
                <span className='truncate font-medium'>{session ? (session.name ?? 'Signed in') : 'Not signed in'}</span>
                {session && (
                  <Badge variant='secondary' className='text-2xs'>
                    {admin.get(auth.issuer) ? 'Admin' : 'Viewer'}
                  </Badge>
                )}
              </div>
              <div className='truncate text-xs text-muted-foreground'>{providerHost(auth.issuer)}</div>
            </div>
            {session ? (
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  void signOut(auth).then(() => {
                    toast.success('Signed out');
                    // Drop the connections using the old token.
                    const { nodes, reconnect } = useNodeStore.getState();
                    for (const n of nodes) reconnect(n.id);
                  })
                }
              >
                <LogOut /> Sign out
              </Button>
            ) : (
              <Button size='sm' disabled={busy} onClick={() => void start(auth)}>
                <LogIn /> Sign in
              </Button>
            )}
          </div>
        );
      })}
    </>
  );
}
