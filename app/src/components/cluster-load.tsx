import { memo } from 'react';
import { getCpuPct, getMemUsagePct, getNetRxMbps, getNetTxMbps } from '@/lib/node-metrics';
import { LiveValue } from './live-value';
import { Sparkline } from './sparkline';
import { NodeName } from './node-name';
import { NodeAvatar } from './node-planet';

/** One node's live load as a compact row. Renders once; values update via refs. */
export const ClusterLoad = memo(function ClusterLoad({ nodeId }: { nodeId: string }) {
  return (
    <div className='grid grid-cols-[minmax(0,10rem)_1fr_1fr] items-center gap-4 px-4 py-3 @3xl:grid-cols-[minmax(0,12rem)_1fr_1fr_8rem]'>
      <div className='flex min-w-0 items-center gap-2 text-sm'>
        <NodeAvatar nodeId={nodeId} size={24} />
        <NodeName nodeId={nodeId} />
      </div>
      <div className='flex items-center gap-2'>
        <span className='label-hud w-8 text-2xs text-muted-foreground'>CPU</span>
        <Sparkline nodeId={nodeId} metric='cpu' color='var(--color-cpu)' scale='percent' className='h-6 min-w-0 flex-1' />
        <LiveValue nodeId={nodeId} className='w-9 text-right text-xs tabular-nums' format={(h) => `${getCpuPct(h)}%`} />
      </div>
      <div className='flex items-center gap-2'>
        <span className='label-hud w-8 text-2xs text-muted-foreground'>RAM</span>
        <Sparkline nodeId={nodeId} metric='ram' color='var(--color-ram)' scale='percent' className='h-6 min-w-0 flex-1' />
        <LiveValue nodeId={nodeId} className='w-9 text-right text-xs tabular-nums' format={(h) => `${getMemUsagePct(h)}%`} />
      </div>
      <LiveValue
        nodeId={nodeId}
        className='hidden text-right text-xs tabular-nums text-muted-foreground @3xl:block'
        format={(h) => `${getNetTxMbps(h)}↑ ${getNetRxMbps(h)}↓ Mbps`}
      />
    </div>
  );
});
