import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { LogIn, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { completeSignIn } from '@/stores/auth';
import { useNodeStore } from '@/stores/nodes';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

/**
 * Where the identity provider sends the browser back. Finishes the code
 * exchange, then carries on with whatever was waiting: usually adding a node.
 * Browser build only; the desktop app catches its callback in Rust.
 */
export function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // The code can be exchanged once; StrictMode's second effect run must not try again.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const after = await completeSignIn(window.location.href);
        const store = useNodeStore.getState();
        if (after.addNodeUrl) {
          const result = await store.addNode(after.addNodeUrl);
          if (result.ok) {
            toast.success('Node added');
            router.history.replace(`/nodes/${result.id}`);
            return;
          }
          // Already added (a seeded node) is fine; anything else is worth saying.
          if (result.error !== 'This node is already added.') toast.error(result.error);
        }
        router.history.replace(after.returnTo || '/overview');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sign-in failed.');
      }
    })();
  }, [router]);

  return (
    <>
      <PageHeader title='Sign in' />
      {error ? (
        <EmptyState
          size='page'
          icon={TriangleAlert}
          title='Sign-in failed'
          description={error}
          action={
            <Button variant='outline' onClick={() => router.history.replace('/overview')}>
              Back to Cosmos
            </Button>
          }
        />
      ) : (
        <EmptyState size='page' icon={LogIn} title='Signing in' />
      )}
    </>
  );
}
