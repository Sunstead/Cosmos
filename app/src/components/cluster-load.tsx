import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { useNodeStore } from '@/stores/nodes';
import {
  formatBytes,
  getCpuPct,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
} from '@/lib/node-metrics';
import { LiveValue } from './live-value';
import { Sparkline } from './sparkline';
import { NodeStatusBadge } from './node-status-badge';

/** One node's live load, as a compact row. Never re-renders. */
export const ClusterLoad = memo(function ClusterLoad({ nodeId }: { nodeId: string }) {
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));
  if (!node) return null;

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center gap-2 text-sm'>
        <Link
          to='/nodes/$nodeId'
          params={{ nodeId }}
          className='font-medium hover:underline truncate'
        >
          {node.name}
        </Link>
        <NodeStatusBadge nodeId={nodeId} showLabel={false} />
        <div className='flex-1' />
        <LiveValue
          nodeId={nodeId}
          className='text-xs text-muted-foreground tabular-nums'
          format={(h) =>
            `${getNetTxMbps(h)}↑ ${getNetRxMbps(h)}↓ Mbps · ${formatBytes(h.mem_used_bytes)}`
          }
        />
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <div className='flex items-center gap-2'>
          <span className='label-hud text-[10px] text-muted-foreground w-8'>CPU</span>
          <Sparkline
            nodeId={nodeId}
            metric='cpu'
            color='var(--color-cpu)'
            scale='percent'
            className='h-6 flex-1 min-w-0'
          />
          <LiveValue
            nodeId={nodeId}
            className='text-xs tabular-nums w-10 text-right'
            format={(h) => `${getCpuPct(h)}%`}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='label-hud text-[10px] text-muted-foreground w-8'>RAM</span>
          <Sparkline
            nodeId={nodeId}
            metric='ram'
            color='var(--color-ram)'
            scale='percent'
            className='h-6 flex-1 min-w-0'
          />
          <LiveValue
            nodeId={nodeId}
            className='text-xs tabular-nums w-10 text-right'
            format={(h) => `${getMemUsagePct(h)}%`}
          />
        </div>
      </div>
    </div>
  );
});
