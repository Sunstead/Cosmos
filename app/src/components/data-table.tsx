import { ReactNode, useState } from 'react';
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card } from './ui/card';
import { SkeletonRows } from './skeletons';
import { cn } from '@/lib/utils';

/**
 * Sortable table. Filtering is the page's job, so the page knows the visible
 * count for its header.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  empty,
  loading = false,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  /** Rendered in place of the body when there are no rows. */
  empty: ReactNode;
  /** No rows yet because data is on its way: skeleton rows, not `empty`. */
  loading?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <Card className='p-0' aria-busy={loading && !data.length ? true : undefined}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className='hover:bg-transparent'>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const content = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <TableHead key={header.id} className='h-9 text-xs'>
                    {header.column.getCanSort() ? (
                      <button
                        type='button'
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'group inline-flex items-center gap-1 hover:text-foreground',
                          sorted && 'text-foreground',
                        )}
                      >
                        {content}
                        {sorted === 'asc' ? (
                          <ArrowUp className='size-3' />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className='size-3' />
                        ) : (
                          <ChevronsUpDown className='size-3 opacity-0 group-hover:opacity-50' />
                        )}
                      </button>
                    ) : (
                      content
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {data.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : loading ? (
            <SkeletonRows columns={columns.length} />
          ) : (
            <TableRow className='hover:bg-transparent'>
              <TableCell colSpan={columns.length} className='p-0'>
                {empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
