import { useState } from 'react';
import { CirclePlus, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldLabel } from './ui/field';
import { useNodeStore } from '@/stores/nodes';

// Links the <form> to the submit button, which lives outside it in the footer.
const FORM_ID = 'add-node-form';

export default function AddNode() {
  const addNode = useNodeStore((s) => s.addNode);

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // The store probes the agent before committing, so a bad address or a
    // rejected token surfaces here. The old version was fire-and-forget: the
    // dialog always closed and a dead node was added silently.
    const result = await addNode(url, token.trim() || undefined);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    setOpen(false);
  };

  const reset = () => {
    setUrl('');
    setToken('');
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size='lg' className='gap-2'>
          <CirclePlus />
          Add Node
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add node</DialogTitle>
          <DialogDescription>
            Point Cosmos at a machine running <code>cosmos-agent</code>.
          </DialogDescription>
        </DialogHeader>

        <form id={FORM_ID} onSubmit={handleSubmit} className='space-y-4'>
          <Field>
            <FieldLabel htmlFor='node-url'>Address</FieldLabel>
            <Input
              id='node-url'
              // Not type='url': that would reject `jupiter.local:7700`, which
              // is the most natural thing to type. The store normalises it.
              placeholder='jupiter.local:7700'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete='off'
              autoFocus
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor='node-token'>Token</FieldLabel>
            <Input
              id='node-token'
              type='password'
              placeholder='Required unless the agent allows anonymous access'
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete='off'
            />
          </Field>

          {error && (
            <p className='flex items-start gap-2 text-sm text-error'>
              <TriangleAlert className='size-4 mt-0.5 shrink-0' />
              {error}
            </p>
          )}
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button form={FORM_ID} type='submit' className='min-w-24' disabled={busy}>
            {busy ? 'Connecting…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
