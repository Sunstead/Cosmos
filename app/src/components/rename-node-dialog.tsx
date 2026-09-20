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

export function RenameNodeDialog({
  nodeId,
  open,
  onOpenChange,
}: {
  nodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted only while open, so the field initialises from the current
          name instead of being synced into state from an effect. */}
      {open && (
        <RenameForm
          key={node?.name ?? nodeId}
          nodeId={nodeId}
          initialName={node?.name ?? ''}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function RenameForm({
  nodeId,
  initialName,
  onDone,
}: {
  nodeId: string;
  initialName: string;
  onDone: () => void;
}) {
  const renameNode = useNodeStore((s) => s.renameNode);
  const [name, setName] = useState(initialName);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) renameNode(nodeId, trimmed);
    onDone();
  };

  return (
    <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename node</DialogTitle>
          <DialogDescription>
            A local label. The agent keeps reporting its own name, which will
            override this on the next reconnect if you leave it blank.
          </DialogDescription>
        </DialogHeader>
        <form id='rename-node' onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor='node-name'>Display name</FieldLabel>
            <Input
              id='node-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Cancel</Button>
          </DialogClose>
          <Button form='rename-node' type='submit'>
            Save
          </Button>
        </DialogFooter>
    </DialogContent>
  );
}
