import { ColumnDef } from '@tanstack/react-table';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { formatBytes } from '@/lib/node-metrics';
import { msToDuration } from '@/lib/time';
import { NO_VALUE } from '@/lib/format';
import { Dot, DotVariant } from './dot';
import { ContainerActionsCell } from './container-actions-cell';
import { NodeName } from './node-name';

/** Flattened across nodes; `nodeId` keeps row ids unique. */
export type ContainerRow = ContainerInfo & { nodeId: string };

export function containerStateVariant(state: string): DotVariant {
  switch (state.toLowerCase()) {
    case 'running':
      return 'success';
    case 'paused':
    case 'restarting':
      return 'warning';
    case 'exited':
    case 'dead':
      return 'error';
    default:
      return 'disabled';
  }
}

export function containerUptime(startedAt: string | null, state: string): string {
  if (state !== 'running' || !startedAt) return NO_VALUE;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && started <= Date.now()
    ? msToDuration(Date.now() - started)
    : NO_VALUE;
}

export function containerColumns(showNode: boolean): ColumnDef<ContainerRow>[] {
  const nodeColumn: ColumnDef<ContainerRow> = {
    id: 'node',
    header: 'Node',
    accessorFn: (r) => r.nodeId,
    cell: ({ row }) => <NodeName nodeId={row.original.nodeId} />,
  };

  return [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className='min-w-0'>
          <p className='truncate font-medium'>{row.original.name}</p>
          <p className='truncate font-mono text-2xs text-muted-foreground'>
            {row.original.image}
          </p>
        </div>
      ),
    },
    ...(showNode ? [nodeColumn] : []),
    {
      accessorKey: 'state',
      header: 'Status',
      cell: ({ row }) => (
        <div className='flex items-center gap-2'>
          <Dot variant={containerStateVariant(row.original.state)} />
          <span className='truncate'>{row.original.status}</span>
        </div>
      ),
    },
    {
      accessorKey: 'cpu_pct',
      header: 'CPU',
      cell: ({ row }) => <span className='tabular-nums'>{row.original.cpu_pct.toFixed(1)}%</span>,
    },
    {
      accessorKey: 'mem_used_bytes',
      header: 'Memory',
      cell: ({ row }) => (
        <span className='tabular-nums'>{formatBytes(row.original.mem_used_bytes)}</span>
      ),
    },
    {
      id: 'uptime',
      header: 'Uptime',
      accessorFn: (r) => (r.started_at ? Date.parse(r.started_at) : 0),
      cell: ({ row }) => (
        <span className='tabular-nums text-muted-foreground'>
          {containerUptime(row.original.started_at, row.original.state)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>Actions</span>,
      cell: ({ row }) => <ContainerActionsCell container={row.original} />,
      enableSorting: false,
    },
  ];
}
