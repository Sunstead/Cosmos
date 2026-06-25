import { useHostInfo, useContainers } from '@/api/queries';
import HardwareStatDisplay from '@/components/hardware-stat-display';
import { SpecDisplay } from '@/components/spec-display';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getCpuPct,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
  getTotalDiskGb,
} from '@/lib/node-metrics';
import { secondsToDuration } from '@/lib/time';
import { useMetricsHistory } from '@/stores/metrics-history';
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  HardDrive,
  MemoryStick,
  MoreVertical,
  Server,
  Shell,
} from 'lucide-react';

interface NodeCardProps {
  nodeId: string;
}

export function NodeCard({ nodeId }: NodeCardProps) {
  const { data: host, isLoading, isError } = useHostInfo(nodeId);
  useContainers(nodeId);
  const getHistory = useMetricsHistory((s) => s.getHistory);
  const history = getHistory(nodeId);

  if (isLoading) {
    return (
      <Card className='flex items-center justify-center min-h-48'>
        <p className='text-muted-foreground text-sm'>Connecting...</p>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className='flex items-center justify-center min-h-48'>
        <p className='text-muted-foreground text-sm'>Node unreachable</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-4'>
          <Server />
          <div className='flex-1 flex items-center justify-between'>
            <div>
              <CardTitle>{host?.name}</CardTitle>
              <CardDescription>{host?.hostname}</CardDescription>
            </div>
            <div>
              <p className='text-xs text-muted-foreground text-end'>Uptime</p>
              <p className='text-xs text-success text-end'>
                {secondsToDuration(host?.uptime_secs ?? 0)}
              </p>
            </div>
          </div>
          <Button variant='ghost' size='icon-lg'>
            <MoreVertical />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className='w-full grid grid-cols-[1fr_max-content_2fr] gap-4'>
          <div className='size-full flex items-center justify-center px-6'>
            <img src={`/${host?.name}.png`} alt={`${host?.name} node`} />
          </div>
          <div className='rounded-md border p-4 w-full min-w-56 space-y-2'>
            <SpecDisplay
              icon={Cpu}
              name='CPU'
              model={host?.cpu_model ?? ''}
              details={`${host?.cpu_physical_cores} cores / ${host?.cpu_logical_cores} threads`}
            />
            <SpecDisplay
              icon={MemoryStick}
              name='RAM'
              model={`${Math.round(host?.mem_total_gb ?? 0)}GB`}
              details=''
            />
            <SpecDisplay
              icon={HardDrive}
              name='Storage'
              model={`${getTotalDiskGb(host)}GB`}
              details=''
            />
            <SpecDisplay
              icon={Shell}
              name={host?.os ?? ''}
              model=''
              details=''
            />
          </div>
          <div className='rounded-md border p-4 w-full min-w-0 flex flex-col justify-between'>
            <HardwareStatDisplay
              data={history?.cpu}
              name='CPU'
              color='var(--color-cpu)'
              value={`${getCpuPct(host)}%`}
            />
            <HardwareStatDisplay
              data={history?.ram}
              name='RAM'
              color='var(--color-ram)'
              value={`${getMemUsagePct(host)}%`}
            />
            <HardwareStatDisplay
              data={history?.netRx}
              name='NETWORK'
              color='var(--color-network)'
              value={
                <div className='text-muted-foreground text-end'>
                  <div className='flex items-center justify-end gap-1'>
                    <ArrowUp className='text-network size-4' />
                    <p className='text-xs'>{getNetTxMbps(host)} Mbps</p>
                  </div>
                  <div className='flex items-center justify-end gap-1'>
                    <ArrowDown className='text-network size-4' />
                    <p className='text-xs'>{getNetRxMbps(host)} Mbps</p>
                  </div>
                </div>
              }
            />
            <HardwareStatDisplay
              data={history?.diskRead}
              name='DISK I/O'
              color='var(--color-disk)'
              value='32 MB/s'
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
