import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Logs, MoreHorizontal, Play, RotateCcw, Square } from 'lucide-react';
import { ServiceInfo } from '@/lib/services';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { useContainerActions, useNodeMeta } from '@/api/queries';
import { Button } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { ReadOnlyNote } from './read-only-note';
import { useNodeName, useNodeStore } from '@/stores/nodes';

/** Actions applied to every container in a service at once. */
export const ServiceActionsMenu = memo(function ServiceActionsMenu({
  service,
  size = 'icon',
}: {
  service: ServiceInfo;
  size?: 'icon' | 'icon-xs';
}) {
  const meta = useNodeMeta(service.nodeId);
  const name = useNodeName(service.nodeId);
  const nodeName = useNodeStore((s) => s.nodes.length > 1) ? name : null;
  const { runMany, pending } = useContainerActions(service.nodeId);
  const canAct = meta?.capabilities.container_actions ?? false;
  const href = serviceHref(service.url);
  const ids = service.containers.map((c) => c.id);
  const firstContainer = service.containers[0]?.id;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size={size}
            aria-label={`Actions for ${service.name}`}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-52'>
        <DropdownMenuGroup>
          <DropdownMenuLabel className='truncate'>
            {service.name}
            {nodeName && <span className='font-normal text-muted-foreground'> on {nodeName}</span>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {href && (
          <DropdownMenuItem onClick={() => void openExternal(href)}>
            <ExternalLink /> Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          render={
            <Link
              to='/logs'
              search={{ node: service.nodeId, container: firstContainer }}
            />
          }
        >
          <Logs /> View logs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === service.total}
          onClick={() => void runMany(ids, 'start', service.name)}
        >
          <Play /> Start
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onClick={() => void runMany(ids, 'restart', service.name)}
        >
          <RotateCcw /> Restart
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canAct || !!pending || service.running === 0}
          onClick={() => void runMany(ids, 'stop', service.name)}
        >
          <Square /> Stop
        </DropdownMenuItem>
        {!canAct && <ReadOnlyNote />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
