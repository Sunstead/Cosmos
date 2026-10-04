import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { Card } from '@sunstead/ui/components/card';
import { Skeleton } from '@sunstead/ui/components/skeleton';
import { cn } from '@/lib/utils';

export type Tone = 'default' | 'success' | 'warning' | 'error';

const TONE: Record<Tone, string> = {
  default: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

/** A single figure with a label. The sublabel row only exists when set. */
export function StatCard({
  label,
  value,
  sublabel,
  tone = 'default',
  icon: Icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string | null;
  tone?: Tone;
  icon: LucideIcon;
  loading?: boolean;
}) {
  return (
    <Card data-stat-card className='flex-row items-center gap-3 px-4 py-3'>
      <div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
        <Icon className='size-4.5' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='label-hud truncate text-2xs text-muted-foreground'>{label}</p>
        {loading ? (
          <Skeleton className='mt-1 h-6 w-16' />
        ) : (
          <p className='truncate text-xl leading-7 tabular-nums'>{value}</p>
        )}
        {sublabel && !loading && (
          <p className={cn('truncate text-xs', TONE[tone])}>{sublabel}</p>
        )}
      </div>
    </Card>
  );
}

/** Responsive row of stat cards: as many columns as fit, min 11rem each. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className='grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-4'>{children}</div>
  );
}
