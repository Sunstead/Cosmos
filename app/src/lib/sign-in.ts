import { useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useNodeMeta } from '@/api/queries';
import { OidcAuthInfo } from '@/api/connection';
import { signIn, signOut } from '@/stores/auth';
import { isDesktop } from '@/lib/platform';
import { providerHost } from '@/lib/accounts';

/** The provider a node is waiting to be signed in to, if it is. */
export function useNodeSignIn(nodeId: string): OidcAuthInfo | null {
  const meta = useNodeMeta(nodeId);
  return meta?.status === 'unauthorized' && meta.auth?.kind === 'oidc' ? meta.auth : null;
}

/** Signs in to a provider and reports failures; the browser navigates away. */
export function useSignIn() {
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);

  const start = async (auth: OidcAuthInfo) => {
    setBusy(true);
    try {
      await signIn(auth, { returnTo: pathname });
    } catch (e) {
      toast.error('Sign-in failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return { start, busy };
}

/**
 * Signs out of a provider and says so. The node store drops the connections
 * that used it, so their nodes ask for a sign-in straight away.
 */
export async function signOutAndSay(auth: OidcAuthInfo): Promise<void> {
  await signOut(auth);
  toast.success(`Signed out of ${providerHost(auth.issuer)}`);
}

/** Where sign-in details are kept, for the Account section header. */
export function tokenStorageNote(): string {
  return isDesktop()
    ? 'Your sign-in is kept in the system keychain. Cosmos never sees your password.'
    : 'In the browser, your sign-in is kept in local storage. Cosmos never sees your password.';
}
