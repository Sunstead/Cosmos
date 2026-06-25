import { MetricPoint } from '@/stores/metrics-history';
import { ResponsiveContainer, Area, AreaChart } from 'recharts';

export function HardwareSparkline({
  color,
  data,
}: {
  color: string;
  data: MetricPoint[] | undefined;
}) {
  return (
    <>
      <style>{`.recharts-wrapper *:focus { outline: none !important; }`}</style>
      <ResponsiveContainer width='100%' height={32} className='rounded-md'>
        <AreaChart data={data}>
          <Area
            type='linear'
            dataKey='value'
            stroke={color}
            fill={`color-mix(in srgb, ${color} 10%, transparent)`}
            strokeWidth={1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </>
  );
}
