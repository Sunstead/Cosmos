import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Logs, MoreVertical, Play, RotateCcw, Square } from 'lucide-react';
import { ServiceInfo } from '@/lib/services';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
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

/**
 * Acts on every container in a service at once — which is what "restart
 * Immich" actually means when the service is four containers.
 */
export const ServiceActionsMenu = memo(function ServiceActionsMenu({
  service,
}: {
  service: ServiceInfo;
}) {
  const meta = useNodeMeta(service.nodeId);
  const { run, pending } = useContainerActions(service.nodeId);
  const canAct = meta?.capabilities.container_actions ?? false;
  const href = serviceHref(service.url);

  const applyAll = async (action: 'start' | 'stop' | 'restart') => {
    // Sequential rather than parallel: restarting a compose project all at
    // once tends to trip dependency ordering.
    for (const c of service.containers) {
      await run(c.id, action);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon-lg' className='ml-auto' aria-label='Service actions'>
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <DropdownMenuLabel>{service.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {href && (
          <DropdownMenuItem onSelect={() => openExternal(href)}>
            <ExternalLink />
            Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to='/logs'>
            <Logs />
            View logs
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === service.total}
          onSelect={() => applyAll('start')}
        >
          <Play />
          Start all
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onSelect={() => applyAll('restart')}
        >
          <RotateCcw />
          Restart all
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onSelect={() => applyAll('stop')}
        >
          <Square />
          Stop all
        </DropdownMenuItem>

        {!canAct && (
          <>
            <DropdownMenuSeparator />
            <p className='px-2 py-1.5 text-xs text-muted-foreground'>
              This agent is read-only. Set{' '}
              <code className='font-mono'>allow_actions</code> to enable.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
