import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Info,
  PencilLine,
  Server,
} from 'lucide-react';
import NodeOptionsDropdown from './node-options-dropdown';
import { Button } from './ui/button';
import { TableCell, TableRow } from './ui/table';
import { useContainers, useHostInfo } from '@/api/queries';
import {
  getCpuPct,
  getDiskReadMbps,
  getDiskWriteMbps,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
} from '@/lib/node-metrics';
import { secondsToDuration } from '@/lib/time';
import DualStatDisplay from './dual-stat-display';

export default function NodeTableRow({ nodeId }: { nodeId: string }) {
  const { data: host, isLoading } = useHostInfo(nodeId);
  useContainers(nodeId);

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={8} className='text-muted-foreground text-sm'>
          Connecting...
        </TableCell>
        <TableCell>
          <NodeOptionsDropdown nodeId={nodeId} />
        </TableCell>
      </TableRow>
    );
  }

  if (!host) {
    return (
      <TableRow>
        <TableCell colSpan={8} className='text-muted-foreground text-sm'>
          Node unreachable
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
          <Server />
        </div>
      </TableCell>
      <TableCell className='max-w-0'>
        <p className='text-base font-medium truncate'>{host.name}</p>
        <p className='text-sm font-normal text-muted-foreground truncate'>
          {host.hostname}
        </p>
      </TableCell>
      <TableCell className='tabular-nums'>
        {getCpuPct(host)}%
      </TableCell>
      <TableCell className='tabular-nums whitespace-nowrap'>
        {getMemUsagePct(host)}%
      </TableCell>
      <TableCell>
        <DualStatDisplay
          icon1={ArrowUp}
          icon2={ArrowDown}
          value1={`${getNetTxMbps(host)} Mbps`}
          value2={`${getNetRxMbps(host)} Mbps`}
          color='var(--color-network)'
        />
      </TableCell>
      <TableCell>
        <DualStatDisplay
          icon1={BookOpen}
          icon2={PencilLine}
          value1={`${getDiskReadMbps(host)} MB/s`}
          value2={`${getDiskWriteMbps(host)} MB/s`}
          color='var(--color-disk)'
        />
      </TableCell>
      <TableCell className='text-success tabular-nums whitespace-nowrap'>
        {secondsToDuration(host.uptime_secs)}
      </TableCell>
      <TableCell>
        <Button className='w-full' variant='outline' size='lg'>
          <Info />
          Details
        </Button>
      </TableCell>
      <TableCell>
        <NodeOptionsDropdown nodeId={nodeId} />
      </TableCell>
    </TableRow>
  );
}
