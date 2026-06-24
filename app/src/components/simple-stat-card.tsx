import React from 'react';
import { Card, CardContent } from './ui/card';
import { getStatusColorClass, StatusColor } from '@/lib/colors';
import { cn } from '@/lib/utils';

export default function SimpleStatCard({
  value,
  label,
  unit,
  status,
  statusColor,
  icon: Icon,
}: {
  value: number | string;
  label: string;
  unit?: string;
  status: string;
  statusColor: StatusColor;
  icon: React.ElementType;
}) {
  return (
    <Card className='min-w-64 w-max h-21'>
      <CardContent className='h-full'>
        <div className='flex items-center h-full gap-x-4 text-muted-foreground'>
          <div className='size-10'>
            <Icon className='size-full' />
          </div>
          <div>
            <div className='flex items-end space-x-1'>
              <p className='text-xl text-foreground leading-tight'>{value}</p>
              <p className='text-sm text-foreground'>{unit}</p>
            </div>
            <p className='leading-snug'>{label}</p>
            <p className={cn('leading-snug', getStatusColorClass(statusColor))}>
              {status}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
