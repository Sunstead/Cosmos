import { memo, useState } from 'react';
import { Copy, Logs, MoreVertical, Play, RotateCcw, Square, Trash } from 'lucide-react';
import { ContainerRow } from './container-columns';
import { useContainerActions, useNodeMeta } from '@/api/queries';
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
import { Link } from '@tanstack/react-router';

/**
 * The container action menu.
 *
 * Every item here except "copy ID" used to render with no handler at all —
 * there were no agent endpoints behind them. They're wired now, and disabled
 * with an explanation when the agent is read-only rather than silently doing
 * nothing.
 */
export const ContainerActionsCell = memo(function ContainerActionsCell({
  container,
}: {
  container: ContainerRow;
}) {
  const meta = useNodeMeta(container.nodeId);
  const { run, pending } = useContainerActions(container.nodeId);
  const [removing, setRemoving] = useState(false);

  const canAct = meta?.capabilities.container_actions ?? false;
  const running = container.state === 'running';
  const busy = !!pending;

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
          <DropdownMenuLabel className='truncate max-w-56'>
            {container.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => void navigator.clipboard.writeText(container.id)}
          >
            <Copy /> Copy container ID
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to='/logs'>
              <Logs /> View logs
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canAct || busy || running}
            onSelect={() => void run(container.id, 'start')}
          >
            <Play /> Start
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canAct || busy || !running}
            onSelect={() => void run(container.id, 'stop')}
          >
            <Square /> Stop
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canAct || busy || !running}
            onSelect={() => void run(container.id, 'restart')}
          >
            <RotateCcw /> Restart
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant='destructive'
            disabled={!canAct || busy}
            onSelect={(e) => {
              // Keep the menu from unmounting the dialog with it.
              e.preventDefault();
              setRemoving(true);
            }}
          >
            <Trash /> Remove
          </DropdownMenuItem>

          {!canAct && (
            <p className='px-2 py-1.5 text-xs text-muted-foreground max-w-56'>
              This agent is read-only. Set <code>allow_actions = true</code> in{' '}
              <code>agent.toml</code>.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${container.name}?`}
        description={
          running
            ? 'This container is running and will be killed before removal. Data in named volumes is kept.'
            : 'The container will be removed. Data in named volumes is kept.'
        }
        confirmLabel='Remove'
        onConfirm={async () => {
          await run(container.id, 'remove', { force: running });
        }}
      />
    </div>
  );
});
