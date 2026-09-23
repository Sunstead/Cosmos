import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Placeholders shaped like what they stand in for, built on shadcn's
 * `Skeleton`. Widths vary by position (never randomly, so a re-render doesn't
 * shimmer) to read as text rather than a grid of bars.
 */

const WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'];
const width = (i: number) => WIDTHS[i % WIDTHS.length];

/** Rows for a table whose header is already real. */
export function SkeletonRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r} className='hover:bg-transparent' data-skeleton-row>
          {Array.from({ length: columns }, (_, c) => (
            <TableCell key={c} className='py-3'>
              <Skeleton className={cn('h-4', c === 0 ? width(r) : width(r + c + 2))} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** A headerless table of skeleton rows, for a section's body. */
export function TableSkeleton({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <div aria-busy='true' aria-label='Loading'>
      <Table>
        <TableBody>
          <SkeletonRows columns={columns} rows={rows} />
        </TableBody>
      </Table>
    </div>
  );
}

/** Cards in the same grid a page would lay its real cards out in. */
export function CardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div aria-busy='true' aria-label='Loading' className={className}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className='gap-3 px-4 py-4'>
          <div className='flex items-center gap-3'>
            <Skeleton className='size-9 rounded-lg' />
            <div className='flex-1 space-y-2'>
              <Skeleton className={cn('h-4', width(i))} />
              <Skeleton className='h-3 w-1/3' />
            </div>
          </div>
          <Skeleton className='h-3 w-full' />
          <Skeleton className={cn('h-3', width(i + 2))} />
        </Card>
      ))}
    </div>
  );
}

/** Log output: short timestamp column, ragged message lines. */
export function LogSkeleton({ lines = 14 }: { lines?: number }) {
  return (
    <div aria-busy='true' aria-label='Loading' className='space-y-2.5'>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className='flex gap-3'>
          <Skeleton className='h-3.5 w-14 shrink-0' />
          <Skeleton className={cn('h-3.5', width(i * 3))} />
        </div>
      ))}
    </div>
  );
}
