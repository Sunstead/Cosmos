import { useMemo, useState } from 'react';
import { ChartLine } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import { useMetricHistory, useNodeMeta } from '@/api/queries';
import { MetricSeries } from '@/generated/MetricSeries';
import { PageHeader } from '@/components/page-header';
import { FeatureDisabled, NoNodes } from '@/components/feature-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/node-metrics';

const RANGES = [
  { label: '1h', seconds: 3_600 },
  { label: '6h', seconds: 21_600 },
  { label: '24h', seconds: 86_400 },
  { label: '7d', seconds: 604_800 },
  { label: '30d', seconds: 2_592_000 },
] as const;

interface Row {
  ts: number;
  value: number;
  peak: number;
}

/**
 * Zips the agent's columnar response into the row shape recharts wants.
 *
 * The wire format is columnar because at ten thousand points that's roughly a
 * quarter the bytes of an array of objects — the cost is this one loop.
 */
function toRows(
  series: MetricSeries | undefined,
  key: keyof MetricSeries,
  peakKey: keyof MetricSeries,
): Row[] {
  if (!series) return [];
  const values = series[key] as number[];
  const peaks = series[peakKey] as number[];
  return series.ts.map((ts, i) => ({
    ts: ts * 1000,
    value: values[i] ?? 0,
    peak: peaks?.[i] ?? values[i] ?? 0,
  }));
}

function MetricChart({
  title,
  rows,
  color,
  format,
  domainMax,
}: {
  title: string;
  rows: Row[];
  color: string;
  format: (v: number) => string;
  domainMax?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='label-hud text-sm text-muted-foreground'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='h-56'>
        {rows.length === 0 ? (
          <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
            No data in this range.
          </div>
        ) : (
          <ResponsiveContainer width='100%' height='100%'>
            <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke='var(--color-border)' vertical={false} />
              <XAxis
                dataKey='ts'
                type='number'
                scale='time'
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v) =>
                  new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                }
                stroke='var(--color-muted-foreground)'
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                domain={[0, domainMax ?? 'auto']}
                tickFormatter={format}
                stroke='var(--color-muted-foreground)'
                fontSize={11}
                width={64}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-popover)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  fontSize: 12,
                }}
                labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                formatter={(v, name) => [format(Number(v)), name === 'peak' ? 'peak' : 'avg']}
              />
              {/* Peak sits underneath so an averaged-away spike is still visible. */}
              <Area
                type='monotone'
                dataKey='peak'
                stroke='none'
                fill={`color-mix(in srgb, ${color} 18%, transparent)`}
                isAnimationActive={false}
              />
              <Area
                type='monotone'
                dataKey='value'
                stroke={color}
                strokeWidth={1.5}
                fill={`color-mix(in srgb, ${color} 10%, transparent)`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function MonitoringPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const [nodeId, setNodeId] = useState<string | null>(nodes[0]?.id ?? null);
  const [rangeIndex, setRangeIndex] = useState(0);

  const effectiveNodeId = nodeId ?? nodes[0]?.id ?? null;
  const meta = useNodeMeta(effectiveNodeId);

  const { data, isLoading, error } = useMetricHistory(effectiveNodeId, {
    rangeSeconds: RANGES[rangeIndex].seconds,
    maxPoints: 800,
  });

  const cpu = useMemo(() => toRows(data, 'cpu_pct', 'cpu_pct_max'), [data]);
  const mem = useMemo(() => toRows(data, 'mem_used_bytes', 'mem_used_bytes'), [data]);
  const netRx = useMemo(() => toRows(data, 'net_rx_bps', 'net_rx_bps_max'), [data]);
  const netTx = useMemo(() => toRows(data, 'net_tx_bps', 'net_tx_bps_max'), [data]);
  const diskRead = useMemo(() => toRows(data, 'disk_read_bps', 'disk_read_bps_max'), [data]);
  const diskWrite = useMemo(() => toRows(data, 'disk_write_bps', 'disk_write_bps_max'), [data]);

  if (nodes.length === 0) return <NoNodes what='historical metrics' />;

  if (meta && !meta.capabilities.metrics_history) {
    return (
      <>
        <PageHeader title='MONITORING' />
        <FeatureDisabled
          icon={ChartLine}
          title='History is disabled on this agent'
          description={
            <>
              Set <code>[history] enabled = true</code> in the agent&rsquo;s{' '}
              <code>agent.toml</code>. It keeps a small SQLite database on the node.
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title='MONITORING'
        description={
          data
            ? `${data.ts.length} points at ${data.step_secs}s resolution`
            : 'Historical metrics recorded by the agent.'
        }
        actions={
          <div className='flex items-center gap-2'>
            <Select value={effectiveNodeId ?? ''} onValueChange={setNodeId}>
              <SelectTrigger className='w-40'>
                <SelectValue placeholder='Node' />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {nodeDisplayName(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className='flex rounded-md border p-0.5'>
              {RANGES.map((r, i) => (
                <Button
                  key={r.label}
                  size='sm'
                  variant={i === rangeIndex ? 'secondary' : 'ghost'}
                  className='px-2.5 h-7 text-xs'
                  onClick={() => setRangeIndex(i)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      {error ? (
        <p className='text-sm text-error'>Could not load history: {String(error)}</p>
      ) : isLoading ? (
        <p className='text-sm text-muted-foreground'>Loading…</p>
      ) : null}

      <div className='grid gap-4 @4xl:grid-cols-2'>
        <MetricChart
          title='CPU'
          rows={cpu}
          color='var(--color-cpu)'
          format={(v) => `${Math.round(v)}%`}
          domainMax={100}
        />
        <MetricChart
          title='MEMORY'
          rows={mem}
          color='var(--color-ram)'
          format={formatBytes}
        />
        <MetricChart
          title='NETWORK IN'
          rows={netRx}
          color='var(--color-network)'
          format={(v) => `${formatBytes(v)}/s`}
        />
        <MetricChart
          title='NETWORK OUT'
          rows={netTx}
          color='var(--color-network)'
          format={(v) => `${formatBytes(v)}/s`}
        />
        <MetricChart
          title='DISK READ'
          rows={diskRead}
          color='var(--color-disk)'
          format={(v) => `${formatBytes(v)}/s`}
        />
        <MetricChart
          title='DISK WRITE'
          rows={diskWrite}
          color='var(--color-disk)'
          format={(v) => `${formatBytes(v)}/s`}
        />
      </div>
    </>
  );
}

export default MonitoringPage;
