import SimpleStatCard from '@/components/simple-stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Box, Boxes, ChartLine, Earth, HardDrive } from 'lucide-react';

export default function OverviewPage() {
  return (
    <div className='p-4 space-y-4 max-w-full'>
      <div>
        <h1 className='text-muted-foreground text-xl'>OVERVIEW</h1>
      </div>
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={1}
          label='Node'
          status='All Online'
          statusColor='success'
          icon={Earth}
        />
        <SimpleStatCard
          value={28}
          label='SERVICES'
          status='Running'
          statusColor='default'
          icon={Boxes}
        />
        <SimpleStatCard
          value={63}
          label='CONTAINERS'
          status='Running'
          statusColor='default'
          icon={Box}
        />
        <SimpleStatCard
          value={2.14}
          unit='TB'
          label='TOTAL STORAGE'
          status='60% Used'
          statusColor='default'
          icon={HardDrive}
        />
        <SimpleStatCard
          value={'99.9%'}
          label='UPTIME'
          status='Last 30 Days'
          statusColor='default'
          icon={ChartLine}
        />
      </div>
      <div className='w-full grid grid-cols-3 gap-4'>
        <Card className='col-span-2 h-128'>
          <CardHeader>
            <CardTitle className='text-muted-foreground'>
              CONSTELLATION
            </CardTitle>
          </CardHeader>
          <CardContent></CardContent>
        </Card>
        <Card className='h-128'>
          <CardHeader>
            <CardTitle className='text-muted-foreground'>
              QUICK LAUNCH
            </CardTitle>
          </CardHeader>
          <CardContent></CardContent>
        </Card>
        <Card className='h-64'>
          <CardHeader>
            <CardTitle className='text-muted-foreground'>
              RESOURCE USAGE
            </CardTitle>
          </CardHeader>
          <CardContent></CardContent>
        </Card>
        <Card className='h-64'>
          <CardHeader>
            <CardTitle className='text-muted-foreground'>
              SERVICES
            </CardTitle>
          </CardHeader>
          <CardContent></CardContent>
        </Card>
        <Card className='h-64'>
          <CardHeader>
            <CardTitle className='text-muted-foreground'>
              LOGS
            </CardTitle>
          </CardHeader>
          <CardContent></CardContent>
        </Card>
      </div>
    </div>
  );
}
