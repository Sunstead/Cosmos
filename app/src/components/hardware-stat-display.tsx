import { memo, ReactNode } from 'react';
import { HostInfo } from '@/generated/HostInfo';
import { MetricKey } from '@/lib/ring-buffer';
import { LiveValue } from './live-value';
import { Sparkline } from './sparkline';

interface Props {
  nodeId: string;
  metric: MetricKey;
  name: string;
  color: string;
  scale?: 'percent' | 'auto';
  /** Single readout. Ignored when `children` is supplied. */
  format?: (host: HostInfo) => string;
  /** A composite readout, e.g. `<DualStatDisplay>` for up/down rates. */
  children?: ReactNode;
}

/**
 * One live metric row: label, sparkline, value.
 *
 * Everything that moves inside here is a `<Sparkline>` or a `<LiveValue>`,
 * both of which update through refs. This component itself renders once.
 */
export const HardwareStatDisplay = memo(function HardwareStatDisplay({
  nodeId,
  metric,
  name,
  color,
  scale = 'auto',
  format,
  children,
}: Props) {
  return (
    <div className='flex items-center gap-2 text-foreground'>
      <p className='text-nowrap label-hud text-muted-foreground'>{name}</p>
      <Sparkline
        nodeId={nodeId}
        metric={metric}
        color={color}
        scale={scale}
        className='h-8 flex-1 min-w-0 rounded-md'
      />
      <div className='text-lg text-nowrap tabular-nums'>
        {children ?? (
          format && <LiveValue nodeId={nodeId} format={format} placeholder='—' />
        )}
      </div>
    </div>
  );
});

export default HardwareStatDisplay;
