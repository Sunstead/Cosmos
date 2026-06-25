import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

export default function DualStatDisplay({
  icon1: Icon1,
  icon2: Icon2,
  value1,
  value2,
  color = 'var(--color-foreground)',
  side = 'left',
}: {
  icon1: LucideIcon;
  icon2: LucideIcon;
  value1: string;
  value2: string;
  color?: string;
  side?: 'left' | 'right';
}) {
  return (
    <div className='text-muted-foreground text-end'>
      <div
        className={cn(
          'flex items-center gap-1',
          side == 'left' ? ' justify-start' : 'justify-end',
        )}
      >
        <Icon1 className='size-4' style={{ color: color }} />
        <p className='text-xs'>{value1}</p>
      </div>
      <div
        className={cn(
          'flex items-center gap-1',
          side == 'left' ? ' justify-start' : 'justify-end',
        )}
      >
        <Icon2 className='size-4' style={{ color: color }} />
        <p className='text-xs'>{value2}</p>
      </div>
    </div>
  );
}
