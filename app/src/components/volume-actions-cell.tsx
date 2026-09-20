import { memo, useState } from 'react';
import { Copy, MoreVertical, Trash } from 'lucide-react';
import { VolumeRow } from './volume-columns';
import { useNodeMeta } from '@/api/queries';
import { getConnection } from '@/stores/nodes';
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

/**
 * Volume actions.
 *
 * "Remove" rendered with no handler before. It's wired now, and stays
 * disabled while a container still mounts the volume — Docker would refuse
 * anyway, and the intent here is to make that obvious before the click.
 */
export const VolumeActionsCell = memo(function VolumeActionsCell({
  volume,
}: {
  volume: VolumeRow;
}) {
  const meta = useNodeMeta(volume.nodeId);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inUse = volume.in_use_by.length > 0;
  const canAct = meta?.capabilities.volume_actions ?? false;

  const remove = async () => {
    const conn = getConnection(volume.nodeId);
    if (!conn) return;
    try {
      await conn.client.removeVolume(volume.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not remove volume');
    }
  };

  return (
    <div className='text-right'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon-lg'>
            <MoreVertical />
            <span className='sr-only'>Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-max min-w-52'>
          <DropdownMenuLabel className='truncate max-w-56'>{volume.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(volume.name)}>
            <Copy /> Copy volume name
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
            <Trash /> Remove
          </DropdownMenuItem>
          {inUse && (
            <p className='px-2 py-1.5 text-xs text-muted-foreground max-w-56'>
              In use by {volume.in_use_by.join(', ')}.
            </p>
          )}
          {!inUse && !canAct && (
            <p className='px-2 py-1.5 text-xs text-muted-foreground max-w-56'>
              This agent is read-only.
            </p>
          )}
          {error && <p className='px-2 py-1.5 text-xs text-error max-w-56'>{error}</p>}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Delete volume ${volume.name}?`}
        description='This permanently deletes the data in this volume. It cannot be undone.'
        confirmLabel='Delete volume'
        onConfirm={remove}
      />
    </div>
  );
});
