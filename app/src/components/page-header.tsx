import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Consistent page heading.
 *
 * Every page previously hand-wrote an uppercase string in a `<h1>`; this makes
 * the convention a component so the style lives in one place and the markup
 * stays semantic.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className='min-w-0'>
        <h1 className='label-hud text-xl text-muted-foreground'>{title}</h1>
        {description && (
          <p className='text-sm text-muted-foreground/70 mt-1'>{description}</p>
        )}
      </div>
      {actions && <div className='flex items-center gap-2 shrink-0'>{actions}</div>}
    </div>
  );
}
