import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartRow } from '@/lib/metric-series';
import { Section } from './section';

const AXIS = { stroke: 'var(--color-muted-foreground)', fontSize: 11, tickLine: false } as const;

function timeTick(spanMs: number) {
  return (v: number) =>
    new Date(v).toLocaleString([], spanMs > 86_400_000
      ? { month: 'short', day: 'numeric' }
      : { hour: '2-digit', minute: '2-digit' });
}

/** Average as a line, peak as a band beneath it so averaged-away spikes show. */
export function MetricChart({
  title,
  rows,
  color,
  format,
  max,
}: {
  title: string;
  rows: ChartRow[];
  color: string;
  format: (v: number) => string;
  max?: number;
}) {
  const span = rows.length > 1 ? rows[rows.length - 1].ts - rows[0].ts : 0;

  return (
    <Section title={title} contentClassName='aspect-[5/2] min-h-40 p-2 pr-4'>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart data={rows} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid stroke='var(--color-border)' vertical={false} />
          <XAxis
            dataKey='ts'
            type='number'
            scale='time'
            domain={['dataMin', 'dataMax']}
            tickFormatter={timeTick(span)}
            minTickGap={48}
            {...AXIS}
          />
          <YAxis
            domain={[0, max ?? 'auto']}
            tickFormatter={format}
            width={64}
            axisLine={false}
            {...AXIS}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-border)' }}
            contentStyle={{
              background: 'var(--color-popover)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              fontSize: 12,
            }}
            labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
            formatter={(v, name) => [format(Number(v)), name === 'peak' ? 'Peak' : 'Average']}
          />
          <Area
            type='monotone'
            dataKey='peak'
            stroke='none'
            fill={`color-mix(in srgb, ${color} 16%, transparent)`}
            isAnimationActive={false}
          />
          <Area
            type='monotone'
            dataKey='value'
            stroke={color}
            strokeWidth={1.5}
            fill={`color-mix(in srgb, ${color} 8%, transparent)`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Section>
  );
}
