import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import { ServiceIcon } from '@/lib/service-icons';
import { ServiceInfo } from '@/lib/services';
import { msToDuration } from '@/lib/time';
import {
  formatCpuPercent,
  getServiceStatusDisplay,
  sortContainersByState,
} from '@/lib/service-utils';
import { formatBytes } from '@/lib/node-metrics';
import { displayHost, serviceHref } from '@/lib/agent-url';
import { useTick } from '@/api/queries';
import { openExternal } from '@/lib/open-external';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
  CardFooter,
} from './ui/card';
import { Dot } from './dot';
import { ServiceActionsMenu } from './service-actions-menu';

export const ServiceCard = memo(function ServiceCard({
  serviceInfo,
  className,
}: {
  serviceInfo: ServiceInfo;
  className?: string;
}) {
  const sortedContainers = sortContainersByState(serviceInfo.containers);
  const statusDisplay = getServiceStatusDisplay(serviceInfo.status);

  // Uptime is stored as an instant, so it needs a clock to re-render against.
  // Once a minute is enough for a string that only shows minutes.
  useTick(60_000);
  const uptime = serviceInfo.startedAt
    ? msToDuration(Date.now() - serviceInfo.startedAt)
    : '—';

  const href = serviceHref(serviceInfo.url);

  return (
    <Card className={className}>
      <CardContent className='space-y-4'>
        <div className='flex gap-4'>
          <ServiceIcon service={serviceInfo.key} size={32} className='min-w-8' />
          <div className='flex-1 min-w-0'>
            <CardTitle>{serviceInfo.name}</CardTitle>
            <CardDescription className='text-xs truncate'>
              {serviceInfo.description ?? `${serviceInfo.total} container(s)`}
            </CardDescription>
          </div>
          <ServiceActionsMenu service={serviceInfo} />
        </div>

        <div className='grid grid-cols-3'>
          <div className='text-center text-xs text-muted-foreground'>
            <p className='label-hud'>UPTIME</p>
            <p className='text-success tabular-nums'>{uptime}</p>
          </div>
          <div className='text-center text-xs text-muted-foreground'>
            <p className='label-hud'>CPU</p>
            <p className='text-foreground tabular-nums'>
              {formatCpuPercent(serviceInfo.cpu_pct)}
            </p>
          </div>
          <div className='text-center text-xs text-muted-foreground'>
            <p className='label-hud'>MEMORY</p>
            <p className='text-foreground tabular-nums'>
              {formatBytes(serviceInfo.mem_used_bytes)}
            </p>
          </div>
        </div>

        <div className='flex items-center gap-2 rounded-md bg-muted/40 p-4 text-xs'>
          <span className='label-hud text-muted-foreground'>CONTAINERS</span>
          <div className='flex flex-1 flex-wrap items-center gap-1.5 pl-1'>
            {sortedContainers.map((c) => (
              <Dot
                key={c.id || c.name}
                variant={c.state === 'running' ? 'success' : 'disabled'}
                title={`${c.name} — ${c.state}`}
              />
            ))}
          </div>
          <span className='font-medium text-foreground tabular-nums'>
            {serviceInfo.running} / {serviceInfo.total}
          </span>
        </div>
      </CardContent>

      <CardFooter className='py-2'>
        <div className='flex items-center gap-1 w-full'>
          {href ? (
            <Button
              variant='link'
              // Labels carry bare hostnames, so an <a href> would resolve them
              // as a path inside the app. Open through the OS instead.
              onClick={() => openExternal(href)}
              className='group h-auto justify-start gap-1 p-0 py-2 text-muted-foreground text-xs min-w-0 flex-1 font-normal'
            >
              <span className='truncate'>{displayHost(serviceInfo.url)}</span>
              <ExternalLink className='size-3 min-w-3 opacity-0 group-hover:opacity-100' />
            </Button>
          ) : (
            <p className='text-muted-foreground text-xs py-2 min-w-0 flex-1 truncate'>
              No URL configured
            </p>
          )}
          <div
            className={`flex text-xs items-center gap-1 ${statusDisplay.textClassName}`}
          >
            <Dot variant={statusDisplay.dotVariant} />
            {statusDisplay.label}
          </div>
        </div>
      </CardFooter>
    </Card>
  );
});
