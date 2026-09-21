import { memo, useState } from 'react';
import { Copy, MoreHorizontal, Trash } from 'lucide-react';
import { toast } from 'sonner';
import { VolumeRow } from './volume-columns';
import { useNodeMeta } from '@/api/queries';
import { getConnection } from '@/stores/nodes';
import { copyText } from '@/lib/clipboard';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import { ReadOnlyNote } from './read-only-note';

export const VolumeActionsCell = memo(function VolumeActionsCell({
  volume,
}: {
  volume: VolumeRow;
}) {
  const meta = useNodeMeta(volume.nodeId);
  const [removing, setRemoving] = useState(false);
  const inUse = volume.in_use_by.length > 0;
  const canAct = meta?.capabilities.volume_actions ?? false;

  const remove = async () => {
    const conn = getConnection(volume.nodeId);
    if (!conn) return;
    try {
      await conn.client.removeVolume(volume.name);
      toast.success(`Deleted ${volume.name}`);
    } catch (e) {
      toast.error(`Could not delete ${volume.name}`, {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <div className='flex justify-end'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label={`Actions for ${volume.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-52'>
          <DropdownMenuLabel className='truncate'>{volume.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyText(volume.name, 'Volume name copied')}>
            <Copy /> Copy name
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void copyText(volume.mountpoint, 'Mountpoint copied')}
          >
            <Copy /> Copy mountpoint
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant='destructive'
            disabled={inUse || !canAct}
            onSelect={(e) => {
              e.preventDefault();
              setRemoving(true);
            }}
          >
            <Trash /> Delete
          </DropdownMenuItem>
          {inUse && canAct && (
            <p className='px-2 py-1 text-xs text-muted-foreground'>In use, can't delete</p>
          )}
          {!canAct && <ReadOnlyNote />}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Delete ${volume.name}?`}
        description='This permanently deletes its data.'
        confirmLabel='Delete'
        onConfirm={remove}
      />
    </div>
  );
});
