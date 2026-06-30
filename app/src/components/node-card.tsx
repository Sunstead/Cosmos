import { useHostInfo, useContainers } from '@/api/queries';
import HardwareStatDisplay from '@/components/hardware-stat-display';
import { SpecDisplay } from '@/components/spec-display';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  getCpuPct,
  getDiskReadMbps,
  getDiskType,
  getDiskWriteMbps,
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
  BookOpen,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  PencilLine,
  Server,
  Shell,
} from 'lucide-react';
import NodeOptionsDropdown from './node-options-dropdown';
import { Button } from './ui/button';
import DualStatDisplay from './dual-stat-display';

interface NodeCardProps {
  nodeId: string;
}

export function NodeCard({ nodeId }: NodeCardProps) {
  const { data: host, isLoading } = useHostInfo(nodeId);
  useContainers(nodeId);
  const getHistory = useMetricsHistory((s) => s.getHistory);
  const history = getHistory(nodeId);

  if (isLoading) {
    return (
      <Card className='flex items-center justify-center min-h-48 relative'>
        <div className='flex absolute top-2 right-2'>
          <NodeOptionsDropdown nodeId={nodeId} />
        </div>
        <p className='text-muted-foreground text-sm'>Connecting...</p>
      </Card>
    );
  }

  if (!host) {
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
          <NodeOptionsDropdown nodeId={nodeId} />
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='w-full grid grid-cols-5 gap-4'>
          <div className='size-full flex items-center justify-center max-w-30 mx-auto'>
            <img
              src={`/${host?.name}.png`}
              alt={`${host?.name} node`}
              className='drop-shadow-xl drop-shadow-black/50'
            />
          </div>
          <div className='rounded-md border p-4 space-y-2 col-span-2'>
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
              model={`${getTotalDiskGb(host)}GB ${getDiskType(host)}`}
              details=''
            />
            <SpecDisplay
              icon={Shell}
              name={host?.os ?? ''}
              model=''
              details=''
            />
          </div>
          <div className='rounded-md border p-4 w-full min-w-0 flex flex-col justify-between col-span-2'>
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
                <DualStatDisplay
                  icon1={ArrowUp}
                  icon2={ArrowDown}
                  value1={`${getNetTxMbps(host)} Mbps`}
                  value2={`${getNetRxMbps(host)} Mbps`}
                  color='var(--color-network)'
                  side='right'
                />
              }
            />
            <HardwareStatDisplay
              data={history?.diskRead}
              name='DISK I/O'
              color='var(--color-disk)'
              value={
                <DualStatDisplay
                  icon1={BookOpen}
                  icon2={PencilLine}
                  value1={`${getDiskReadMbps(host)} MB/s`}
                  value2={`${getDiskWriteMbps(host)} MB/s`}
                  color='var(--color-disk)'
                  side='right'
                />
              }
            />
          </div>
        </div>
        <div className='flex justify-between items-center'>
          <div className='flex items-center gap-1'></div>
          <div className='flex items-center'>
            <Button className='w-full' variant='outline' size='lg'>
              <Info />
              Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
