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
      {/* Mounted only while open so the field initialises from current state. */}
      {open && node && (
        <RenameForm
          nodeId={nodeId}
          alias={node.alias ?? ''}
          agentName={node.agentName}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function RenameForm({
  nodeId,
  alias,
  agentName,
  onDone,
}: {
  nodeId: string;
  alias: string;
  agentName: string | null;
  onDone: () => void;
}) {
  const renameNode = useNodeStore((s) => s.renameNode);
  const [name, setName] = useState(alias);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    renameNode(nodeId, name);
    onDone();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename node</DialogTitle>
        <DialogDescription>Leave blank to use the agent's name.</DialogDescription>
      </DialogHeader>
      <form id='rename-node' onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor='node-name'>Display name</FieldLabel>
          <Input
            id='node-name'
            value={name}
            placeholder={agentName ?? undefined}
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
