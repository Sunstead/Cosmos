import { memo, ReactNode } from 'react';
import { HostInfo } from '@/generated/HostInfo';
import { MetricKey } from '@/lib/ring-buffer';
import { LiveValue } from './live-value';
import { Sparkline } from './sparkline';

/** One live metric row: label, sparkline, value. Renders once; values update via refs. */
export const HardwareStatDisplay = memo(function HardwareStatDisplay({
  nodeId,
  metric,
  name,
  color,
  scale = 'auto',
  format,
  children,
}: {
  nodeId: string;
  metric: MetricKey;
  name: string;
  color: string;
  scale?: 'percent' | 'auto';
  format?: (host: HostInfo) => string;
  /** Composite readout, e.g. up/down rates. Replaces `format`. */
  children?: ReactNode;
}) {
  return (
    <div className='grid grid-cols-[4.5rem_1fr_auto] items-center gap-3'>
      <p className='label-hud truncate text-2xs text-muted-foreground'>{name}</p>
      <Sparkline nodeId={nodeId} metric={metric} color={color} scale={scale} className='h-7 w-full min-w-0' />
      <div className='min-w-16 text-right text-sm tabular-nums'>
        {children ?? (format && <LiveValue nodeId={nodeId} format={format} />)}
      </div>
    </div>
  );
});

export default HardwareStatDisplay;
