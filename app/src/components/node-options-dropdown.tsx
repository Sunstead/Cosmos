import { memo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Info, KeyRound, MoreHorizontal, PencilLine, RefreshCw, Trash } from 'lucide-react';
import { useNodeStore, useNodeName } from '@/stores/nodes';
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
  showDetails = true,
}: {
  nodeId: string;
  showDetails?: boolean;
}) {
  const removeNode = useNodeStore((s) => s.removeNode);
  const reconnect = useNodeStore((s) => s.reconnect);
  const name = useNodeName(nodeId) ?? 'this node';
  const meta = useNodeMeta(nodeId);
  const [dialog, setDialog] = useState<'rename' | 'token' | 'remove' | null>(null);
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label={`Options for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-48'>
          {showDetails && (
            <DropdownMenuItem asChild>
              <Link to='/nodes/$nodeId' params={{ nodeId }}>
                <Info /> Details
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog('rename')}>
            <PencilLine /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('token')}>
            <KeyRound /> {meta?.status === 'unauthorized' ? 'Set token' : 'Change token'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => reconnect(nodeId)}>
            <RefreshCw /> Reconnect
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onSelect={() => setDialog('remove')}>
            <Trash /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameNodeDialog nodeId={nodeId} open={dialog === 'rename'} onOpenChange={close} />
      <NodeCredentialsDialog nodeId={nodeId} open={dialog === 'token'} onOpenChange={close} />
      <ConfirmDialog
        open={dialog === 'remove'}
        onOpenChange={close}
        title={`Remove ${name}?`}
        description='Cosmos forgets this node and its token. The node itself is unchanged.'
        confirmLabel='Remove'
        onConfirm={() => removeNode(nodeId)}
      />
    </>
  );
});

export default NodeOptionsDropdown;
