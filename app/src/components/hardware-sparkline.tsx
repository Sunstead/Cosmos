import { LineChart, Line, ResponsiveContainer, Area, AreaChart } from 'recharts';

// #region Sample data
const data = [
  {
    name: 'Page A',
    uv: 400,
    pv: 2400,
    amt: 2400,
  },
  {
    name: 'Page B',
    uv: 300,
    pv: 4567,
    amt: 2400,
  },
  {
    name: 'Page C',
    uv: 320,
    pv: 1398,
    amt: 2400,
  },
  {
    name: 'Page D',
    uv: 200,
    pv: 9800,
    amt: 2400,
  },
  {
    name: 'Page E',
    uv: 278,
    pv: 3908,
    amt: 2400,
  },
  {
    name: 'Page F',
    uv: 189,
    pv: 4800,
    amt: 2400,
  },
];

export function HardwareSparkline({ color }: { color: string }) {
  return (
    <>
      <style>{`.recharts-wrapper *:focus { outline: none !important; }`}</style>
      <ResponsiveContainer
        width='100%'
        height={32}
        className='rounded-md'
        style={{
          // backgroundColor: `color-mix(in srgb, ${color} 5%, transparent)`,
        }}
      >
        <AreaChart data={data}>
          <Area
            type='linear'
            dataKey='uv'
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
