import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { LogIn, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { useNodeStore } from '@/stores/nodes';
import { useUiStore } from '@/stores/ui';
import { signIn } from '@/stores/auth';
import { OidcAuthInfo } from '@/api/connection';

/** Mounted once in the shell; opened through the UI store. */
export function AddNodeDialog() {
  const open = useUiStore((s) => s.addNodeOpen);
  const initialUrl = useUiStore((s) => s.addNodeUrl);
  const setOpen = useUiStore((s) => s.setAddNodeOpen);

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      {open && <AddNodeForm initialUrl={initialUrl} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function AddNodeForm({ initialUrl, onDone }: { initialUrl: string; onDone: () => void }) {
  const addNode = useNodeStore((s) => s.addNode);
  const navigate = useNavigate();
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the agent is fine and just wants a sign-in first. */
  const [needsSignIn, setNeedsSignIn] = useState<OidcAuthInfo | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    const result = await addNode(url);
    setBusy(false);

    if (!result.ok) {
      setNeedsSignIn(result.signIn ?? null);
      if (!result.signIn) setError(result.error);
      return;
    }
    toast.success('Node added');
    onDone();
    void navigate({ to: '/nodes/$nodeId', params: { nodeId: result.id } });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void add();
  };

  const startSignIn = async (auth: OidcAuthInfo) => {
    setBusy(true);
    setError(null);
    try {
      // The browser leaves here and comes back to /auth/callback, which
      // finishes adding the node. The desktop app waits, then carries on.
      await signIn(auth, { returnTo: '/nodes', addNodeUrl: url });
      setNeedsSignIn(null);
      await add();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add node</DialogTitle>
        <DialogDescription>Connect a machine running cosmos-agent.</DialogDescription>
      </DialogHeader>

      <form id='add-node' onSubmit={submit} className='space-y-4'>
        <Field>
          <FieldLabel htmlFor='node-url'>Address</FieldLabel>
          <Input
            id='node-url'
            placeholder='jupiter.local:7700'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete='off'
            spellCheck={false}
            autoFocus
            required
          />
        </Field>
        {needsSignIn && (
          <div className='flex items-center justify-between gap-3 rounded-md border p-3 text-sm'>
            <span>
              This node signs in with <span className='font-medium'>{new URL(needsSignIn.issuer).host}</span>.
            </span>
            <Button type='button' size='sm' disabled={busy} onClick={() => void startSignIn(needsSignIn)}>
              <LogIn /> Sign in
            </Button>
          </div>
        )}
        {error && (
          <p role='alert' className='flex items-center gap-2 text-sm text-error'>
            <TriangleAlert className='size-4 shrink-0' />
            {error}
          </p>
        )}
      </form>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant='outline'>Cancel</Button>
        </DialogClose>
        <Button form='add-node' type='submit' className='min-w-24' disabled={busy || !url.trim() || !!needsSignIn}>
          {busy ? 'Connecting' : 'Add'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
