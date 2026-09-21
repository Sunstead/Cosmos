import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one page header. The row is exactly one control tall (h-8), and every
 * control placed in `actions` is h-8, so titles sit at the same height on
 * every page.
 */
export function PageHeader({
  title,
  count,
  actions,
  leading,
  className,
}: {
  title: string;
  /** Before the title, e.g. a back button. Must be h-8. */
  leading?: ReactNode;
  /** Small tabular badge after the title, e.g. a result count. */
  count?: number | string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-page-header
      className={cn('flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2', className)}
    >
      <div className='flex h-8 min-w-0 items-center gap-2'>
        {leading}
        <h1 className='label-hud truncate text-base leading-8 text-muted-foreground'>{title}</h1>
        {count !== undefined && (
          <span className='rounded-md bg-muted px-1.5 text-2xs leading-5 tabular-nums text-muted-foreground'>
            {count}
          </span>
        )}
      </div>
      {actions && (
        <div data-page-actions className='ml-auto flex flex-wrap items-center gap-2'>
          {actions}
        </div>
      )}
    </header>
  );
}
