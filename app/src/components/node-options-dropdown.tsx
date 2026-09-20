import { memo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Info, KeyRound, MoreVertical, PencilLine, RefreshCw, Trash } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useNodeMeta } from '@/api/queries';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import { NodeCredentialsDialog } from './node-credentials-dialog';
import { RenameNodeDialog } from './rename-node-dialog';

export const NodeOptionsDropdown = memo(function NodeOptionsDropdown({
  nodeId,
}: {
  nodeId: string;
}) {
  // Selecting the individual actions rather than the whole store: this is
  // rendered inside every card and every table row.
  const removeNode = useNodeStore((s) => s.removeNode);
  const reconnect = useNodeStore((s) => s.reconnect);
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));
  const meta = useNodeMeta(nodeId);

  const [renaming, setRenaming] = useState(false);
  const [editingToken, setEditingToken] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-lg' aria-label='Node options'>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          <DropdownMenuItem asChild>
            <Link to='/nodes/$nodeId' params={{ nodeId }}>
              <Info />
              Details
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <PencilLine />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditingToken(true)}>
            <KeyRound />
            {meta?.status === 'unauthorized' ? 'Set token' : 'Change token'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => reconnect(nodeId)}>
            <RefreshCw />
            Reconnect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ConfirmDialog
            trigger={
              <DropdownMenuItem
                variant='destructive'
                // Without this the menu closes and unmounts the dialog with it.
                onSelect={(e) => e.preventDefault()}
              >
                <Trash />
                Remove node
              </DropdownMenuItem>
            }
            title={`Remove ${node?.name ?? 'this node'}?`}
            description={
              <>
                Cosmos will stop monitoring this node and forget its saved token.
                Nothing on the node itself is changed, and you can add it back at
                any time.
              </>
            }
            confirmLabel='Remove'
            onConfirm={() => removeNode(nodeId)}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameNodeDialog nodeId={nodeId} open={renaming} onOpenChange={setRenaming} />
      <NodeCredentialsDialog
        nodeId={nodeId}
        open={editingToken}
        onOpenChange={setEditingToken}
      />
    </>
  );
});

export default NodeOptionsDropdown;
