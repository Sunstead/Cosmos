import { memo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { ServiceIcon } from '@/lib/service-icons';
import { ServiceInfo } from '@/lib/services';
import { msToDuration } from '@/lib/time';
import { NO_VALUE, plural } from '@/lib/format';
import {
  formatCpuPercent,
  getServiceStatusDisplay,
  sortContainersByState,
} from '@/lib/service-utils';
import { formatBytes } from '@/lib/node-metrics';
import { displayHost, serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { useNow } from '@/api/queries';
import { UptimeEntry } from '@/generated/UptimeEntry';
import { ServiceCheckChip } from './uptime-bar';
import { Card } from '@sunstead/ui/components/card';
import { Dot } from './dot';
import { ServiceActionsMenu } from './service-actions-menu';
import { NodeName } from './node-name';

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className='min-w-0'>
      <p className='label-hud text-2xs text-muted-foreground'>{label}</p>
      <p className={`truncate text-sm tabular-nums ${className ?? ''}`}>{value}</p>
    </div>
  );
}

export const ServiceCard = memo(function ServiceCard({
  service,
  showNode,
  check,
}: {
  service: ServiceInfo;
  showNode?: boolean;
  /** Its uptime check, when it has one. */
  check?: UptimeEntry;
}) {
  const status = getServiceStatusDisplay(service.status);
  const href = serviceHref(service.url);

  // Uptime is an instant; re-render once a minute to keep it current.
  const now = useNow(60_000);
  const uptime = service.startedAt ? msToDuration(Math.max(0, now - service.startedAt)) : NO_VALUE;

  return (
    <Card className='gap-4 px-4 py-4'>
      <div className='flex items-start gap-3'>
        <ServiceIcon service={service.key} size={32} className='shrink-0' />
        <div className='min-w-0 flex-1'>
          <p className='truncate font-medium leading-5'>{service.name}</p>
          <p className='truncate text-xs text-muted-foreground'>
            {service.description ?? plural(service.total, 'container')}
          </p>
        </div>
        <ServiceActionsMenu service={service} />
      </div>

      <div className='grid grid-cols-3 gap-2'>
        <Metric label='Uptime' value={uptime} />
        <Metric label='CPU' value={formatCpuPercent(service.cpu_pct)} />
        <Metric label='Memory' value={formatBytes(service.mem_used_bytes)} />
      </div>

      <div className='flex items-center gap-2 border-t pt-3 text-xs'>
        <span className={`flex items-center gap-1.5 ${status.textClassName}`}>
          <Dot variant={status.dotVariant} />
          {status.label}
        </span>
        <span className='flex items-center gap-1' aria-label={`${service.running} of ${service.total} running`}>
          {sortContainersByState(service.containers).map((c) => (
            <Dot
              key={c.id || c.name}
              variant={c.state !== 'running' ? 'disabled' : c.health === 'unhealthy' ? 'warning' : 'success'}
              title={`${c.name}: ${c.state}${c.health ? `, ${c.health}` : ''}`}
              className='size-1.5'
            />
          ))}
        </span>
        {check && <ServiceCheckChip check={check} />}
        {showNode && <NodeName nodeId={service.nodeId} />}
        <span className='flex-1' />
        {href && (
          <button
            type='button'
            onClick={() => void openExternal(href)}
            className='flex min-w-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground'
          >
            <span className='truncate'>{displayHost(service.url)}</span>
            <ArrowUpRight className='size-3 shrink-0' />
          </button>
        )}
      </div>
    </Card>
  );
});
