import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, BookOpen, Info, PencilLine } from 'lucide-react';
import { useHostInfo, useNodeMeta } from '@/api/queries';
import {
  getCpuPct,
  getDiskReadMbps,
  getDiskWriteMbps,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
} from '@/lib/node-metrics';
import { secondsToDuration } from '@/lib/time';
import { TableCell, TableRow } from './ui/table';
import { Button } from './ui/button';
import DualStatDisplay from './dual-stat-display';
import { LiveValue } from './live-value';
import NodeOptionsDropdown from './node-options-dropdown';
import { NodePlanet } from './node-planet';
import { NodeStatusBadge } from './node-status-badge';

/** Matches the 9 `<TableHead>` cells in nodes-page. */
const DATA_COLUMNS = 8;

export const NodeTableRow = memo(function NodeTableRow({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  const { data: host } = useHostInfo(nodeId);

  if (!host) {
    const connecting = !meta || meta.status === 'connecting';
    return (
      <TableRow>
        {/* Was colSpan={8} against a 9-column header, leaving the row short. */}
        <TableCell colSpan={DATA_COLUMNS} className='text-sm'>
          {connecting ? (
            <span className='text-muted-foreground'>Connecting…</span>
          ) : (
            <span className='flex items-center gap-2'>
              <NodeStatusBadge nodeId={nodeId} />
              {meta?.error && (
                <span className='text-muted-foreground text-xs truncate'>{meta.error}</span>
              )}
            </span>
          )}
        </TableCell>
        <TableCell>
          <NodeOptionsDropdown nodeId={nodeId} />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <div className='size-full flex items-center justify-center'>
          <NodePlanet name={host.name} className='size-8' />
        </div>
      </TableCell>
      <TableCell className='max-w-0'>
        <p className='text-base font-medium truncate'>{host.name}</p>
        <p className='text-sm font-normal text-muted-foreground truncate'>{host.hostname}</p>
      </TableCell>
      <TableCell className='tabular-nums'>
        <LiveValue nodeId={nodeId} format={(h) => `${getCpuPct(h)}%`} />
      </TableCell>
      <TableCell className='tabular-nums whitespace-nowrap'>
        <LiveValue nodeId={nodeId} format={(h) => `${getMemUsagePct(h)}%`} />
      </TableCell>
      <TableCell>
        <DualStatDisplay
          nodeId={nodeId}
          icon1={ArrowUp}
          icon2={ArrowDown}
          format1={(h) => `${getNetTxMbps(h)} Mbps`}
          format2={(h) => `${getNetRxMbps(h)} Mbps`}
          color='var(--color-network)'
        />
      </TableCell>
      <TableCell>
        <DualStatDisplay
          nodeId={nodeId}
          icon1={BookOpen}
          icon2={PencilLine}
          format1={(h) => `${getDiskReadMbps(h)} MB/s`}
          format2={(h) => `${getDiskWriteMbps(h)} MB/s`}
          color='var(--color-disk)'
        />
      </TableCell>
      <TableCell className='text-success tabular-nums whitespace-nowrap'>
        <LiveValue nodeId={nodeId} format={(h) => secondsToDuration(h.uptime_secs)} />
      </TableCell>
      <TableCell>
        <Button asChild className='w-full' variant='outline' size='lg'>
          <Link to='/nodes/$nodeId' params={{ nodeId }}>
            <Info />
            Details
          </Link>
        </Button>
      </TableCell>
      <TableCell>
        <NodeOptionsDropdown nodeId={nodeId} />
      </TableCell>
    </TableRow>
  );
});

export default NodeTableRow;
