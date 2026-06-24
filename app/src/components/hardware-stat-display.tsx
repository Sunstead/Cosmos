import { ReactNode } from 'react';
import { HardwareSparkline } from './hardware-sparkline';

export default function HardwareStatDisplay({
  name,
  color,
  value,
}: {
  name: string;
  color: string;
  value: ReactNode;
}) {
  return (
    <div className='flex items-center gap-2 text-foreground'>
      <p className='text-nowrap'>{name}</p>
      <HardwareSparkline color={color} />
      <div className='text-lg text-nowrap'>{value}</div>
    </div>
  );
}
