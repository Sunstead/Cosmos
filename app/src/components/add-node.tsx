import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
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
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await addNode(url, token.trim() || undefined);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success('Node added');
    onDone();
    void navigate({ to: '/nodes/$nodeId', params: { nodeId: result.id } });
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
        <Field>
          <FieldLabel htmlFor='node-token'>Token</FieldLabel>
          <Input
            id='node-token'
            type='password'
            placeholder='Optional'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete='off'
          />
        </Field>
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
        <Button form='add-node' type='submit' className='min-w-24' disabled={busy || !url.trim()}>
          {busy ? 'Connecting' : 'Add'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
