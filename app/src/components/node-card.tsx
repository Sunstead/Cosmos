import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  PencilLine,
  Shell,
} from 'lucide-react';
import { useHostInfo, useNodeMeta } from '@/api/queries';
import {
  formatBytes,
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
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SpecDisplay } from '@/components/spec-display';
import { Button } from './ui/button';
import DualStatDisplay from './dual-stat-display';
import HardwareStatDisplay from './hardware-stat-display';
import { LiveValue } from './live-value';
import NodeOptionsDropdown from './node-options-dropdown';
import { NodePlanet } from './node-planet';
import { NodeStatusBadge } from './node-status-badge';

/**
 * A node's summary card.
 *
 * Re-renders only when the node's *connection state* changes — never when a
 * sample arrives. Every live number is a `<LiveValue>` and every chart a
 * `<Sparkline>`, both writing through refs. Previously the whole subtree,
 * including a Radix dropdown and four recharts instances, was rebuilt once a
 * second.
 */
export const NodeCard = memo(function NodeCard({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  // Read once for the parts that genuinely don't change — CPU model, core
  // count, OS, total RAM. Later samples carry identical values.
  const { data: host } = useHostInfo(nodeId);

  if (!meta || (meta.status === 'connecting' && !host)) {
    return (
      <Card className='flex items-center justify-center min-h-48 relative'>
        <div className='absolute top-2 right-2'>
          <NodeOptionsDropdown nodeId={nodeId} />
        </div>
        <p className='text-muted-foreground text-sm'>Connecting…</p>
      </Card>
    );
  }

  if (!host) {
    return (
      <Card className='flex flex-col items-center justify-center gap-3 min-h-48 relative p-6'>
        <div className='absolute top-2 right-2'>
          <NodeOptionsDropdown nodeId={nodeId} />
        </div>
        <NodeStatusBadge nodeId={nodeId} />
        {meta.error && (
          <p className='text-muted-foreground text-xs text-center max-w-xs'>
            {meta.error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-4'>
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2'>
              <p className='text-lg font-medium truncate'>{host.name}</p>
              <NodeStatusBadge nodeId={nodeId} />
            </div>
            <p className='text-sm text-muted-foreground truncate'>{host.hostname}</p>
          </div>
          <div className='text-end shrink-0'>
            <p className='text-xs text-muted-foreground'>Uptime</p>
            <LiveValue
              nodeId={nodeId}
              className='text-xs text-success tabular-nums'
              format={(h) => secondsToDuration(h.uptime_secs)}
            />
          </div>
          <NodeOptionsDropdown nodeId={nodeId} />
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        <div className='w-full grid grid-cols-5 gap-4'>
          <div className='size-full flex items-center justify-center max-w-30 mx-auto'>
            <NodePlanet name={host.name} className='size-24' />
          </div>

          <div className='rounded-md border p-4 space-y-2 col-span-2'>
            <SpecDisplay
              icon={Cpu}
              name='CPU'
              model={host.cpu_model}
              details={`${host.cpu_physical_cores} cores / ${host.cpu_logical_cores} threads`}
            />
            <SpecDisplay
              icon={MemoryStick}
              name='RAM'
              model={formatBytes(host.mem_total_bytes)}
              details=''
            />
            <SpecDisplay
              icon={HardDrive}
              name='Storage'
              model={`${getTotalDiskGb(host)}GB ${getDiskType(host)}`}
              details=''
            />
            <SpecDisplay icon={Shell} name={host.os} model='' details='' />
          </div>

          <div className='rounded-md border p-4 w-full min-w-0 flex flex-col justify-between col-span-2'>
            <HardwareStatDisplay
              nodeId={nodeId}
              metric='cpu'
              name='CPU'
              color='var(--color-cpu)'
              scale='percent'
              format={(h) => `${getCpuPct(h)}%`}
            />
            <HardwareStatDisplay
              nodeId={nodeId}
              metric='ram'
              name='RAM'
              color='var(--color-ram)'
              scale='percent'
              format={(h) => `${getMemUsagePct(h)}%`}
            />
            <HardwareStatDisplay
              nodeId={nodeId}
              metric='netRx'
              name='NETWORK'
              color='var(--color-network)'
            >
              <DualStatDisplay
                nodeId={nodeId}
                icon1={ArrowUp}
                icon2={ArrowDown}
                format1={(h) => `${getNetTxMbps(h)} Mbps`}
                format2={(h) => `${getNetRxMbps(h)} Mbps`}
                color='var(--color-network)'
                side='right'
              />
            </HardwareStatDisplay>
            <HardwareStatDisplay
              nodeId={nodeId}
              metric='diskRead'
              name='DISK I/O'
              color='var(--color-disk)'
            >
              <DualStatDisplay
                nodeId={nodeId}
                icon1={BookOpen}
                icon2={PencilLine}
                format1={(h) => `${getDiskReadMbps(h)} MB/s`}
                format2={(h) => `${getDiskWriteMbps(h)} MB/s`}
                color='var(--color-disk)'
                side='right'
              />
            </HardwareStatDisplay>
          </div>
        </div>

        <div className='flex justify-end'>
          <Button asChild variant='outline' size='lg'>
            <Link to='/nodes/$nodeId' params={{ nodeId }}>
              <Info />
              Details
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
