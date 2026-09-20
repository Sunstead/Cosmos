import { ColumnDef } from '@tanstack/react-table';
import { VolumeInfo } from '@/generated/VolumeInfo';
import { Checkbox } from '@/components/ui/checkbox';
import { VolumeActionsCell } from './volume-actions-cell';
import { Dot, DotVariant } from './dot';

// Volumes are flattened across nodes for the table; nodeId keeps row ids
// unique since volume names can collide across nodes.
export type VolumeRow = VolumeInfo & { nodeId: string };

function usageVariant(inUseBy: string[]): DotVariant {
  return inUseBy.length > 0 ? 'success' : 'disabled';
}

function formatCreatedAt(createdAt: string | null): string {
  if (!createdAt) return '—';
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return '—';
  return created.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const columns: ColumnDef<VolumeRow>[] = [
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
    id: 'service',
    header: 'Service',
    cell: ({ row }) => {
      const service = row.original.compose_project ?? row.original.cosmos_service;
      return service ? <span>{service}</span> : <span className='text-muted-foreground'>—</span>;
    },
  },
  {
    accessorKey: 'mountpoint',
    header: 'Mountpoint',
    cell: ({ row }) => (
      <span className='text-muted-foreground font-mono text-xs truncate block max-w-64'>
        {row.original.mountpoint}
      </span>
    ),
  },
  {
    accessorKey: 'driver',
    header: 'Driver',
    cell: ({ row }) => <span className='text-muted-foreground'>{row.original.driver}</span>,
  },
  {
    id: 'usage',
    header: 'Status',
    cell: ({ row }) => {
      const { in_use_by } = row.original;
      return (
        <div className='flex items-center gap-2'>
          <Dot variant={usageVariant(in_use_by)} />
          <span>{in_use_by.length > 0 ? `In use (${in_use_by.length})` : 'Unused'}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => formatCreatedAt(row.original.created_at),
  },
  {
    id: 'actions',
    cell: ({ row }) => <VolumeActionsCell volume={row.original} />,
    enableSorting: false,
    enableHiding: false,
  },
];