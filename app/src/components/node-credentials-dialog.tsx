import { useState } from 'react';
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
import { isTauri } from '@/lib/tauri';

export function NodeCredentialsDialog({
  nodeId,
  open,
  onOpenChange,
}: {
  nodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateNodeToken = useNodeStore((s) => s.updateNodeToken);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateNodeToken(nodeId, token.trim());
      setToken('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agent token</DialogTitle>
          <DialogDescription>
            The shared token from this agent&rsquo;s <code>agent.toml</code>.{' '}
            {isTauri()
              ? 'It is stored in your system keychain.'
              : 'In the browser build this is kept in local storage, which is readable by any script on the page.'}
          </DialogDescription>
        </DialogHeader>
        <form id='node-token' onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor='token'>Token</FieldLabel>
            <Input
              id='token'
              type='password'
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder='••••••••••••••••'
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
            {busy ? 'Saving…' : 'Save & reconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
