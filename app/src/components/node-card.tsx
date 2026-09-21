import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, BookOpen, ChevronRight, PencilLine, RefreshCw } from 'lucide-react';
import { useHostInfo, useNodeMeta } from '@/api/queries';
import { useNodeName, useNodeStore } from '@/stores/nodes';
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
import { Card } from '@/components/ui/card';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import DualStatDisplay from './dual-stat-display';
import HardwareStatDisplay from './hardware-stat-display';
import { LiveValue } from './live-value';
import NodeOptionsDropdown from './node-options-dropdown';
import { NodeAvatar } from './node-planet';
import { NodeStatusBadge } from './node-status-badge';

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <p className='label-hud text-2xs text-muted-foreground'>{label}</p>
      <p className='truncate text-sm' title={value}>
        {value}
      </p>
    </div>
  );
}

function Header({ nodeId, subtitle }: { nodeId: string; subtitle?: string }) {
  const name = useNodeName(nodeId);
  return (
    <div className='flex items-center gap-3'>
      <NodeAvatar nodeId={nodeId} size={40} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <Link
            to='/nodes/$nodeId'
            params={{ nodeId }}
            className='truncate font-medium hover:underline'
          >
            {name}
          </Link>
          <NodeStatusBadge nodeId={nodeId} />
        </div>
        {subtitle && subtitle !== name && <p className='truncate text-xs text-muted-foreground'>{subtitle}</p>}
      </div>
      <NodeOptionsDropdown nodeId={nodeId} />
    </div>
  );
}

/**
 * Node summary. Re-renders on connection state only; live values are
 * LiveValue/Sparkline leaves that update through refs.
 */
export const NodeCard = memo(function NodeCard({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  const { data: host } = useHostInfo(nodeId);
  const reconnect = useNodeStore((s) => s.reconnect);

  if (!host) {
    const connecting = !meta || meta.status === 'connecting';
    return (
      <Card className='gap-4 px-4 py-4'>
        <Header nodeId={nodeId} subtitle={connecting ? undefined : (meta?.error ?? undefined)} />
        {connecting ? (
          <div className='grid gap-2'>
            <Skeleton className='h-7' />
            <Skeleton className='h-7' />
          </div>
        ) : (
          <div className='flex justify-end'>
            <Button variant='outline' onClick={() => reconnect(nodeId)}>
              <RefreshCw />
              Retry
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card className='@container gap-4 px-4 py-4'>
      <Header nodeId={nodeId} subtitle={host.hostname} />

      <div className='grid gap-4 @2xl:grid-cols-[minmax(0,14rem)_1fr]'>
        <div className='grid grid-cols-2 content-start gap-x-4 gap-y-3 @2xl:grid-cols-1'>
          <Spec label='CPU' value={`${host.cpu_model}, ${host.cpu_logical_cores} threads`} />
          <Spec label='Memory' value={formatBytes(host.mem_total_bytes)} />
          <Spec label='Storage' value={`${getTotalDiskGb(host)} GB ${getDiskType(host)}`} />
          <Spec label='OS' value={host.os} />
        </div>

        <div className='flex flex-col justify-between gap-1.5'>
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
            name='Memory'
            color='var(--color-ram)'
            scale='percent'
            format={(h) => `${getMemUsagePct(h)}%`}
          />
          <HardwareStatDisplay nodeId={nodeId} metric='netRx' name='Network' color='var(--color-network)'>
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
          <HardwareStatDisplay nodeId={nodeId} metric='diskRead' name='Disk' color='var(--color-disk)'>
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

      <div className='flex items-center justify-between border-t pt-3 text-xs text-muted-foreground'>
        <span>
          Up <LiveValue nodeId={nodeId} className='tabular-nums text-foreground' format={(h) => secondsToDuration(h.uptime_secs)} />
        </span>
        <Link
          to='/nodes/$nodeId'
          params={{ nodeId }}
          className='flex items-center gap-0.5 transition-colors hover:text-foreground'
        >
          Details
          <ChevronRight className='size-3.5' />
        </Link>
      </div>
    </Card>
  );
});
