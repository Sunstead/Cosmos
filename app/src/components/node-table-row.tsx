import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { useHostInfo, useNodeMeta } from '@/api/queries';
import { useNodeName } from '@/stores/nodes';
import {
  formatDiskReadWrite,
  getCpuPct,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
} from '@/lib/node-metrics';
import { secondsToDuration } from '@/lib/time';
import { TableCell, TableHead, TableHeader, TableRow } from '@sunstead/ui/components/table';
import { LiveValue } from './live-value';
import NodeOptionsDropdown from './node-options-dropdown';
import { NodeAvatar } from './node-planet';
import { NodeStatusBadge } from './node-status-badge';
import { Sparkline } from './sparkline';

const COLUMNS = ['Node', 'CPU', 'Memory', 'Network', 'Disk', 'Uptime', ''] as const;

/** The header row for a table of `NodeTableRow`s. */
export function NodeTableHeader() {
  return (
    <TableHeader>
      <TableRow className='hover:bg-transparent'>
        {COLUMNS.map((c, i) => (
          <TableHead key={i} className='h-9 text-xs'>
            {c}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export const NodeTableRow = memo(function NodeTableRow({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  const { data: host } = useHostInfo(nodeId);
  const name = useNodeName(nodeId);

  return (
    <TableRow>
      <TableCell>
        <div className='flex min-w-0 items-center gap-3'>
          <NodeAvatar nodeId={nodeId} size={28} />
          <div className='min-w-0'>
            <Link
              to='/nodes/$nodeId'
              params={{ nodeId }}
              className='block truncate font-medium hover:underline'
            >
              {name}
            </Link>
            {host ? (
              host.hostname !== name && (
                <p className='truncate text-xs text-muted-foreground'>{host.hostname}</p>
              )
            ) : (
              <NodeStatusBadge nodeId={nodeId} />
            )}
          </div>
        </div>
      </TableCell>
      {host ? (
        <>
          <TableCell>
            <div className='flex items-center gap-2'>
              <Sparkline nodeId={nodeId} metric='cpu' color='var(--color-cpu)' scale='percent' className='h-6 w-16' />
              <LiveValue nodeId={nodeId} className='w-10 tabular-nums' format={(h) => `${getCpuPct(h)}%`} />
            </div>
          </TableCell>
          <TableCell>
            <div className='flex items-center gap-2'>
              <Sparkline nodeId={nodeId} metric='ram' color='var(--color-ram)' scale='percent' className='h-6 w-16' />
              <LiveValue nodeId={nodeId} className='w-10 tabular-nums' format={(h) => `${getMemUsagePct(h)}%`} />
            </div>
          </TableCell>
          <TableCell className='text-xs tabular-nums text-muted-foreground'>
            <LiveValue nodeId={nodeId} format={(h) => `${getNetTxMbps(h)} / ${getNetRxMbps(h)} Mbps`} />
          </TableCell>
          <TableCell className='text-xs tabular-nums text-muted-foreground'>
            <LiveValue nodeId={nodeId} format={formatDiskReadWrite} />
          </TableCell>
          <TableCell className='tabular-nums text-muted-foreground'>
            <LiveValue nodeId={nodeId} format={(h) => secondsToDuration(h.uptime_secs)} />
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={5} className='text-xs text-muted-foreground'>
          {meta?.error ?? 'Waiting for data'}
        </TableCell>
      )}
      <TableCell className='w-12 text-right'>
        <NodeOptionsDropdown nodeId={nodeId} />
      </TableCell>
    </TableRow>
  );
});
