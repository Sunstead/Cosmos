import { useHostInfo, useContainers } from '@/api/queries';
import { HardwareSparkline } from '@/components/hardware-sparkline';
import HardwareStatDisplay from '@/components/hardware-stat-display';
import SimpleStatCard from '@/components/simple-stat-card';
import { SpecDisplay } from '@/components/spec-display';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useNodeStore } from '@/stores/nodes';
import {
  ArrowDown,
  ArrowUp,
  ChartLine,
  Check,
  Cpu,
  Globe,
  GlobeCheck,
  GlobeOff,
  HardDrive,
  MemoryStick,
  MoreVertical,
  Server,
  Shell,
} from 'lucide-react';

export function NodesPage() {
  const activeNodeId = useNodeStore((s) => s.activeNodeId);
  const addNode = useNodeStore((s) => s.addNode);
  const { data: host, isLoading, isError } = useHostInfo(activeNodeId);
  const { data: containers } = useContainers(activeNodeId);

  if (isLoading) return <div>Connecting...</div>;
  if (isError) return <div>Node unreachable</div>;

  return (
    <div className='p-4 space-y-4 max-w-full'>
      <div>
        <h1 className='text-muted-foreground text-xl'>NODES</h1>
      </div>
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={'4'}
          label={'TOTAL NODES'}
          status={'All Online'}
          statusColor={'success'}
          icon={Server}
        />
        <SimpleStatCard
          value={'4'}
          label={'ONLINE'}
          status={''}
          statusColor={'default'}
          icon={GlobeCheck}
        />
        <SimpleStatCard
          value={'0'}
          label={'OFFLINE'}
          status={''}
          statusColor={'default'}
          icon={GlobeOff}
        />
        <SimpleStatCard
          value={'99.99%'}
          label={'AVG UPTIME'}
          status={'Last 30 Days'}
          statusColor={'default'}
          icon={ChartLine}
        />
      </div>
      <div className='grid grid-cols-2 w-full'>
        <Card>
          <CardHeader>
            <div className='flex items-center gap-4'>
              <Server />
              <div className='flex-1 flex items-center justify-between'>
                <div>
                  <CardTitle>Jupiter</CardTitle>
                  <CardDescription>jupiter.local</CardDescription>
                </div>
                <div>
                  <p className='text-xs text-muted-foreground text-end'>
                    Uptime
                  </p>
                  <p className='text-xs text-success text-end'>2d 14h 32m</p>
                </div>
              </div>
              <Button variant='ghost' size='icon-lg'>
                <MoreVertical />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className='w-full grid grid-cols-[108px_1fr_1fr] gap-4'>
              <Globe />
              <div className='rounded-md border p-4 w-full min-w-0 space-y-2'>
                <SpecDisplay
                  icon={Cpu}
                  name={'CPU'}
                  model={'AMD Ryzen 5950x'}
                  details={'8 cores / 16 threads'}
                />
                <SpecDisplay
                  icon={MemoryStick}
                  name={'RAM'}
                  model={'64GB DDR4'}
                  details={'3600 MT/s'}
                />
                <SpecDisplay
                  icon={HardDrive}
                  name={'Storage'}
                  model={'2TB HDD'}
                  details={''}
                />
                <SpecDisplay
                  icon={Shell}
                  name={'Debian Linux 13.5 LTS'}
                  model={''}
                  details={''}
                />
              </div>
              <div className='rounded-md border p-4 w-full min-w-0 flex flex-col justify-between'>
                <HardwareStatDisplay
                  name={'CPU'}
                  color={'var(--color-cpu)'}
                  value={'12%'}
                />
                <HardwareStatDisplay
                  name={'RAM'}
                  color={'var(--color-ram)'}
                  value={'42%'}
                />
                <HardwareStatDisplay
                  name={'NETWORK'}
                  color={'var(--color-network)'}
                  value={
                    <div className='text-muted-foreground text-end'>
                      <div className='flex items-center justify-end gap-1'>
                        <ArrowUp className='text-network size-4' />
                        <p className='text-xs'>18.4 Mbps</p>
                      </div>
                      <div className='flex items-center justify-end gap-1'>
                        <ArrowDown className='text-network size-4' />
                        <p className='text-xs'>6.7 Mbps</p>
                      </div>
                    </div>
                  }
                />
                <HardwareStatDisplay
                  name={'DISK I/O'}
                  color={'var(--color-disk)'}
                  value={'32 MB/s'}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
