import { memo } from 'react';
import { LucideIcon } from 'lucide-react';
import { HostInfo } from '@/generated/HostInfo';
import { cn } from '@/lib/utils';
import { LiveValue } from './live-value';

interface Props {
  nodeId: string;
  icon1: LucideIcon;
  icon2: LucideIcon;
  format1: (host: HostInfo) => string;
  format2: (host: HostInfo) => string;
  color?: string;
  side?: 'left' | 'right';
}

/** A paired readout — up/down, read/write — both values updating live. */
export const DualStatDisplay = memo(function DualStatDisplay({
  nodeId,
  icon1: Icon1,
  icon2: Icon2,
  format1,
  format2,
  color = 'var(--color-foreground)',
  side = 'left',
}: Props) {
  const row = cn(
    'flex items-center gap-1',
    side === 'left' ? 'justify-start' : 'justify-end',
  );

  return (
    <div className='text-muted-foreground text-end'>
      <div className={row}>
        <Icon1 className='size-4 shrink-0' style={{ color }} />
        <LiveValue nodeId={nodeId} format={format1} className='text-xs tabular-nums' />
      </div>
      <div className={row}>
        <Icon2 className='size-4 shrink-0' style={{ color }} />
        <LiveValue nodeId={nodeId} format={format2} className='text-xs tabular-nums' />
      </div>
    </div>
  );
});

export default DualStatDisplay;
