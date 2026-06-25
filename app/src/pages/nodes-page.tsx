import { NodeCard } from '@/components/node-card';
import SimpleStatCard from '@/components/simple-stat-card';
import { useNodeStore } from '@/stores/nodes';
import { ChartLine, GlobeCheck, GlobeOff, Server } from 'lucide-react';

export function NodesPage() {
  const nodesRecord = useNodeStore((s) => s.nodes);
  const nodes = Object.values(nodesRecord);

  return (
    <div className='p-4 space-y-4 max-w-full'>
      <div>
        <h1 className='text-muted-foreground text-xl'>NODES</h1>
      </div>
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={String(nodes.length)}
          label='TOTAL NODES'
          status='All Online'
          statusColor='success'
          icon={Server}
        />
        <SimpleStatCard
          value={String(nodes.length)}
          label='ONLINE'
          status=''
          statusColor='default'
          icon={GlobeCheck}
        />
        <SimpleStatCard
          value='0'
          label='OFFLINE'
          status=''
          statusColor='default'
          icon={GlobeOff}
        />
        <SimpleStatCard
          value='99.99%'
          label='AVG UPTIME'
          status='Last 30 Days'
          statusColor='default'
          icon={ChartLine}
        />
      </div>
      <div className='grid grid-cols-2 w-full gap-4'>
        {nodes.length === 0 ? (
          <p className='text-muted-foreground text-sm col-span-2'>
            No nodes configured.
          </p>
        ) : (
          nodes.map((node) => <NodeCard key={node.id} nodeId={node.id} />)
        )}
      </div>
    </div>
  );
}
