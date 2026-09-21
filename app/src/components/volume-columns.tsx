import { ColumnDef } from '@tanstack/react-table';
import { VolumeInfo } from '@/generated/VolumeInfo';
import { NO_VALUE } from '@/lib/format';
import { VolumeActionsCell } from './volume-actions-cell';
import { Dot } from './dot';
import { NodeName } from './node-name';

/** Flattened across nodes; `nodeId` keeps row ids unique. */
export type VolumeRow = VolumeInfo & { nodeId: string };

function formatDate(iso: string | null): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? NO_VALUE
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function volumeColumns(showNode: boolean): ColumnDef<VolumeRow>[] {
  const nodeColumn: ColumnDef<VolumeRow> = {
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
          <p className='selectable max-w-80 truncate font-mono text-2xs text-muted-foreground'>
            {row.original.mountpoint}
          </p>
        </div>
      ),
    },
    ...(showNode ? [nodeColumn] : []),
    {
      id: 'service',
      header: 'Service',
      accessorFn: (r) => r.compose_project ?? r.cosmos_service ?? '',
      cell: ({ getValue }) => (
        <span className='text-muted-foreground'>{(getValue() as string) || NO_VALUE}</span>
      ),
    },
    {
      id: 'usage',
      header: 'Status',
      accessorFn: (r) => r.in_use_by.length,
      cell: ({ row }) => {
        const users = row.original.in_use_by;
        return (
          <div className='flex items-center gap-2' title={users.join(', ') || undefined}>
            <Dot variant={users.length ? 'success' : 'disabled'} />
            {users.length ? `In use by ${users.length}` : 'Unused'}
          </div>
        );
      },
    },
    {
      accessorKey: 'driver',
      header: 'Driver',
      cell: ({ row }) => <span className='text-muted-foreground'>{row.original.driver}</span>,
    },
    {
      accessorKey: 'created_at',
      header: 'Created',
      cell: ({ row }) => (
        <span className='tabular-nums text-muted-foreground'>
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>Actions</span>,
      cell: ({ row }) => <VolumeActionsCell volume={row.original} />,
      enableSorting: false,
    },
  ];
}
