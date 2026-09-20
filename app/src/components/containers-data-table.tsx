import { useState } from 'react';
import {
  ColumnDef,
  RowSelectionState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
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
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  onRowSelectionChange?: (selected: TData[]) => void;
  emptyMessage?: string;
  /** Renders a search box that filters across every column. */
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
}

/**
 * The shared table for containers and volumes.
 *
 * Previously core-model only: no sorting and no filtering, which is painful
 * once a host runs a few dozen containers.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  getRowId,
  onRowSelectionChange,
  emptyMessage = 'No data found.',
  searchPlaceholder,
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
    state: { rowSelection, sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: (updater) => {
      setRowSelection((old) => {
        const next = typeof updater === 'function' ? updater(old) : updater;
        onRowSelectionChange?.(
          table
            .getRowModel()
            .rows.filter((r) => next[r.id])
            .map((r) => r.original),
        );
        return next;
      });
    },
    enableRowSelection: true,
  });

  return (
    <>
      {(searchPlaceholder || toolbar) && (
        <div className='flex items-center gap-2'>
          {searchPlaceholder && (
            <Input
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className='max-w-sm'
            />
          )}
          {toolbar}
          <span className='text-xs text-muted-foreground tabular-nums ml-auto'>
            {table.getFilteredRowModel().rows.length} of {data.length}
          </span>
        </div>
      )}

      <Card className='p-0'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type='button'
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'group inline-flex items-center gap-1 hover:text-foreground',
                            sorted && 'text-foreground',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className='size-3' />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className='size-3' />
                          ) : (
                            <ChevronsUpDown className='size-3 opacity-0 group-hover:opacity-50' />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center text-muted-foreground'
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
