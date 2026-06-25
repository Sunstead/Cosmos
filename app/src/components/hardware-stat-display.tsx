import { ReactNode } from 'react';
import { HardwareSparkline } from './hardware-sparkline';
import { MetricPoint } from '@/stores/metrics-history';

export default function HardwareStatDisplay({
  name,
  color,
  data,
  value,
}: {
  name: string;
  color: string;
  data: MetricPoint[] | undefined;
  value: ReactNode;
}) {
  return (
    <div className='flex items-center gap-2 text-foreground'>
      <p className='text-nowrap'>{name}</p>
      <HardwareSparkline color={color} data={data} />
      <div className='text-lg text-nowrap'>{value}</div>
    </div>
  );
}
