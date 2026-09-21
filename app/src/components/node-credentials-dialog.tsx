import { useState } from 'react';
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
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useNodeStore } from '@/stores/nodes';

export function NodeCredentialsDialog({
  nodeId,
  open,
  onOpenChange,
}: {
  nodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <TokenForm nodeId={nodeId} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function TokenForm({ nodeId, onDone }: { nodeId: string; onDone: () => void }) {
  const updateNodeToken = useNodeStore((s) => s.updateNodeToken);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateNodeToken(nodeId, token.trim());
      toast.success('Token saved');
      onDone();
    } catch {
      toast.error('Could not save token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Agent token</DialogTitle>
        <DialogDescription>The token from this agent's configuration.</DialogDescription>
      </DialogHeader>
      <form id='node-token' onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor='token'>Token</FieldLabel>
          <Input
            id='token'
            type='password'
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete='off'
            autoFocus
          />
        </Field>
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant='outline'>Cancel</Button>
        </DialogClose>
        <Button form='node-token' type='submit' disabled={busy || !token.trim()}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
