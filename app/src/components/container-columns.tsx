import { ColumnDef } from '@tanstack/react-table';
import { ContainerInfo } from '@/generated/ContainerInfo';
import { Checkbox } from '@/components/ui/checkbox';
import { Dot, DotVariant } from './dot';
import { ContainerActionsCell } from './container-actions-cell';
import { formatBytes } from '@/lib/node-metrics';
import { msToDuration } from '@/lib/time';

// Containers are flattened across nodes for the table; nodeId keeps row ids
// unique since container ids can theoretically collide across nodes.
export type ContainerRow = ContainerInfo & { nodeId: string };

function stateToVariant(state: string): DotVariant {
  switch (state.toLowerCase()) {
    case 'running':
      return 'success';
    case 'paused':
      return 'warning';
    case 'exited':
    case 'dead':
      return 'error';
    default:
      return 'disabled';
  }
}

// Uptime and size formatting live in lib/ so the table and the cards can't
// drift apart; these were duplicated here before.
function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '—';
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return '—';

  const diffMs = Date.now() - started;
  if (diffMs < 0) return '—';
  return msToDuration(diffMs);
}

export const columns: ColumnDef<ContainerRow>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <div className='w-6 flex justify-end'>
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label='Select all'
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className='flex w-6 justify-end'>
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label='Select row'
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
  },
  {
    accessorKey: 'image',
    header: 'Image',
    cell: ({ row }) => (
      <span className='text-muted-foreground'>{row.original.image}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const { state, status } = row.original;
      return (
        <div className='flex items-center gap-2'>
          <Dot variant={stateToVariant(state)} />
          <span>{status}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'cpu_pct',
    header: () => <div className='text-right'>CPU</div>,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>
        {row.original.cpu_pct.toFixed(1)}%
      </div>
    ),
  },
  {
    accessorKey: 'mem_used_bytes',
    header: () => <div className='text-right'>Memory</div>,
    cell: ({ row }) => (
      <div className='text-right tabular-nums'>
        {formatBytes(row.original.mem_used_bytes)}
      </div>
    ),
  },
  {
    accessorKey: 'started_at',
    header: 'Uptime',
    cell: ({ row }) => formatUptime(row.original.started_at),
  },
  {
    id: 'actions',
    cell: ({ row }) => <ContainerActionsCell container={row.original} />,
    enableSorting: false,
    enableHiding: false,
  },
];
