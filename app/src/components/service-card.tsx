import { ServiceIcon } from '@/lib/service-icons';
import { MoreVertical, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
  CardFooter,
} from './ui/card';
import { ServiceInfo } from '@/lib/services';
import { msToDuration } from '@/lib/time';
import {
  formatCpuPercent,
  formatMemoryGb,
  getServiceStatusDisplay,
  sortContainersByState,
} from '@/lib/service-utils';
import { Dot } from './dot';

export function ServiceCard({
  serviceInfo,
  className,
}: {
  serviceInfo: ServiceInfo;
  className?: string;
}) {
  const sortedContainers = sortContainersByState(serviceInfo.containers);
  const statusDisplay = getServiceStatusDisplay(serviceInfo.status);

  return (
    <Card className={className}>
      <CardContent className='space-y-4'>
        <div className='flex gap-4'>
          <ServiceIcon
            service={serviceInfo.key}
            size={32}
            className='min-w-8'
          />
          <div className='flex-1 min-w-0'>
            <CardTitle>{serviceInfo.name}</CardTitle>
            <CardDescription className='text-xs truncate'>
              {serviceInfo.description}
            </CardDescription>
          </div>
          <Button variant='ghost' size='icon-lg' className='ml-auto'>
            <MoreVertical />
          </Button>
        </div>
        <div className='grid grid-cols-3'>
          <div className='text-center text-xs text-muted-foreground'>
            <p>UPTIME</p>
            <p className='text-success'>
              {msToDuration(serviceInfo.uptime_ms ?? 0)}
            </p>
          </div>
          <div className='text-center text-xs text-muted-foreground'>
            <p>CPU</p>
            <p className='text-foreground'>
              {formatCpuPercent(serviceInfo.cpu_pct)}
            </p>
          </div>
          <div className='text-center text-xs text-muted-foreground'>
            <p>MEMORY</p>
            <p className='text-foreground'>
              {formatMemoryGb(serviceInfo.mem_mb)}
            </p>
          </div>
        </div>
        <Button
          variant='secondary'
          className='flex items-center gap-2 bg-muted/40 hover:bg-muted p-4 text-xs w-full h-max'
        >
          <span className='tracking-wider text-muted-foreground'>
            CONTAINERS
          </span>
          <div className='flex flex-1 items-center gap-1.5 pl-1'>
            {sortedContainers.map((c) => (
              <Dot
                key={c.name}
                variant={c.state === 'running' ? 'success' : 'disabled'}
              />
            ))}
          </div>
          <span className='font-medium text-foreground'>
            {serviceInfo.running} / {serviceInfo.total}
          </span>
        </Button>
      </CardContent>
      <CardFooter className='py-2'>
        <div className='flex items-center gap-1 w-full'>
          {serviceInfo.url ? (
            <a
              className='group flex items-center gap-1 text-muted-foreground text-xs hover:underline py-2 min-w-0 flex-1'
              href={serviceInfo.url}
              target='_blank'
              rel='noopener'
            >
              <p className='truncate'>{serviceInfo.url}</p>
              <ExternalLink className='size-3 min-w-3 hidden group-hover:inline-block' />
            </a>
          ) : (
            <p className='text-muted-foreground text-xs py-2 min-w-0 flex-1 truncate'>
              No URL configured
            </p>
          )}
          <div className='flex items-center'>
            <div
              className={`flex text-xs items-center gap-1 ${statusDisplay.textClassName}`}
            >
              <Dot variant={statusDisplay.dotVariant} />
              {statusDisplay.label}
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}
