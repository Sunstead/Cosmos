import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A titled card. The header row is h-8 like the page header, so section
 * titles line up with their controls.
 */
export function Section({
  title,
  count,
  actions,
  children,
  className,
  contentClassName,
  ...rest
}: {
  title: ReactNode;
  count?: number | string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
} & { [data: `data-${string}`]: string | boolean | undefined }) {
  return (
    <Card className={cn('gap-0 py-0', className)} {...rest}>
      <div className='flex min-h-12 items-center gap-2 border-b px-4 py-2'>
        <h2 className='label-hud flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground'>
          {title}
        </h2>
        {count !== undefined && (
          <span className='rounded-md bg-muted px-1.5 text-2xs leading-5 tabular-nums text-muted-foreground'>
            {count}
          </span>
        )}
        {actions && <div className='ml-auto flex items-center gap-2'>{actions}</div>}
      </div>
      <div className={cn('min-w-0', contentClassName)}>{children}</div>
    </Card>
  );
}
