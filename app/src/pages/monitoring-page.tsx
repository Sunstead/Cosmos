import { useMemo } from 'react';
import { ChartLine, TriangleAlert } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useMetricHistory, useNodeMeta } from '@/api/queries';
import { formatBytes } from '@/lib/node-metrics';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { PageHeader } from '@/components/page-header';
import { NodeSelect, useSelectedNode } from '@/components/node-select';
import { SegmentedControl } from '@/components/segmented-control';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { NodeUnavailable } from '@/components/sign-in';
import { SETUP } from '@/components/setup-hint';
import { MetricChart, toRows } from '@/components/metric-chart';
import { Skeleton } from '@/components/ui/skeleton';

const RANGES = {
  '1h': 3_600,
  '6h': 21_600,
  '24h': 86_400,
  '7d': 604_800,
  '30d': 2_592_000,
} as const;

type Range = keyof typeof RANGES;

const rate = (v: number) => `${formatBytes(v)}/s`;
const pct = (v: number) => `${Math.round(v)}%`;

export function MonitoringPage() {
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const [nodeId, setNodeId] = useSelectedNode();
  const [range, setRange] = usePersistentState<Range>('cosmos-monitoring-range', '1h');
  const meta = useNodeMeta(nodeId);

  const { data, isLoading, error } = useMetricHistory(nodeId, {
    rangeSeconds: RANGES[range] ?? RANGES['1h'],
    maxPoints: 600,
  });

  const charts = useMemo(
    () => [
      { title: 'CPU', rows: toRows(data, 'cpu_pct', 'cpu_pct_max'), color: 'var(--color-cpu)', format: pct, max: 100 },
      { title: 'Memory', rows: toRows(data, 'mem_used_bytes', 'mem_used_bytes'), color: 'var(--color-ram)', format: formatBytes },
      { title: 'Network in', rows: toRows(data, 'net_rx_bps', 'net_rx_bps_max'), color: 'var(--color-network)', format: rate },
      { title: 'Network out', rows: toRows(data, 'net_tx_bps', 'net_tx_bps_max'), color: 'var(--color-network)', format: rate },
      { title: 'Disk read', rows: toRows(data, 'disk_read_bps', 'disk_read_bps_max'), color: 'var(--color-disk)', format: rate },
      { title: 'Disk write', rows: toRows(data, 'disk_write_bps', 'disk_write_bps_max'), color: 'var(--color-disk)', format: rate },
    ],
    [data],
  );

  const enabled = meta?.capabilities.metrics_history ?? false;

  const body = () => {
    if (nodeCount === 0) return <NoNodesState />;
    if (meta?.status === 'online' && !enabled) {
      return (
        <EmptyState
          size='page'
          icon={ChartLine}
          title='History not enabled'
          description='This agent is not recording metrics.'
          setup={SETUP.history}
        />
      );
    }
    if (nodeId && (meta?.status === 'offline' || meta?.status === 'unauthorized')) {
      return <NodeUnavailable nodeId={nodeId} />;
    }
    if (error) return <EmptyState size='page' icon={TriangleAlert} title='Could not load history' />;
    if (isLoading || !data) {
      return (
        <div className='grid gap-4 @4xl:grid-cols-2'>
          {charts.map((c) => (
            <Skeleton key={c.title} className='aspect-[5/2] min-h-40' />
          ))}
        </div>
      );
    }
    if (data.ts.length === 0) {
      return (
        <EmptyState
          size='page'
          icon={ChartLine}
          title='No history yet'
          description='Samples appear within a minute of the agent starting.'
        />
      );
    }
    return (
      <div className='grid gap-4 @4xl:grid-cols-2'>
        {charts.map((c) => (
          <MetricChart key={c.title} {...c} />
        ))}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title='Monitoring'
        actions={
          nodeCount > 0 && (
            <>
              <NodeSelect value={nodeId} onChange={setNodeId} />
              <SegmentedControl<Range>
                label='Time range'
                value={range}
                onChange={setRange}
                options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))}
              />
            </>
          )
        }
      />
      {body()}
    </>
  );
}
