import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Logs, MoreHorizontal, Play, RotateCcw, Square } from 'lucide-react';
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
import { ReadOnlyNote } from './read-only-note';

/** Actions applied to every container in a service at once. */
export const ServiceActionsMenu = memo(function ServiceActionsMenu({
  service,
}: {
  service: ServiceInfo;
}) {
  const meta = useNodeMeta(service.nodeId);
  const { runMany, pending } = useContainerActions(service.nodeId);
  const canAct = meta?.capabilities.container_actions ?? false;
  const href = serviceHref(service.url);
  const ids = service.containers.map((c) => c.id);
  const firstContainer = service.containers[0]?.id;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' size='icon' aria-label={`Actions for ${service.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <DropdownMenuLabel className='truncate'>{service.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {href && (
          <DropdownMenuItem onSelect={() => void openExternal(href)}>
            <ExternalLink /> Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to='/logs' search={{ node: service.nodeId, container: firstContainer }}>
            <Logs /> View logs
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === service.total}
          onSelect={() => void runMany(ids, 'start', service.name)}
        >
          <Play /> Start
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onSelect={() => void runMany(ids, 'restart', service.name)}
        >
          <RotateCcw /> Restart
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onSelect={() => void runMany(ids, 'stop', service.name)}
        >
          <Square /> Stop
        </DropdownMenuItem>
        {!canAct && <ReadOnlyNote />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
