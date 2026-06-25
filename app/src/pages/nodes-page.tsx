import AddNode from '@/components/add-node';
import GridListToggle, { GridListView } from '@/components/grid-list-toggle';
import { NodeCard } from '@/components/node-card';
import NodeEmpty from '@/components/node-empty';
import SimpleStatCard from '@/components/simple-stat-card';
import { useNodeStore } from '@/stores/nodes';
import { ChartLine, GlobeCheck, GlobeOff, Server } from 'lucide-react';
import { useState } from 'react';

export function NodesPage() {
  const [view, setView] = useState<GridListView>('grid');
  const { onlineNodes } = useNodeStore();
  const nodes = useNodeStore((s) => s.nodes);

  return (
    <div className='p-4 space-y-4 max-w-full h-full flex flex-col'>
      <div className='flex justify-between items-center'>
        <h1 className='text-muted-foreground text-xl'>NODES</h1>
        <div className='flex items-center gap-4'>
          <GridListToggle view={view} onViewChange={setView} />
          <AddNode />
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className='flex-1 flex justify-center items-center'>
          <NodeEmpty />
        </div>
      ) : (
        <>
          <div className='flex flex-wrap gap-4 max-w-full'>
            <SimpleStatCard
              value={String(nodes.length)}
              label='TOTAL NODES'
              status='All Online'
              statusColor='success'
              icon={Server}
            />
            <SimpleStatCard
              value={onlineNodes}
              label='ONLINE'
              status=''
              statusColor='default'
              icon={GlobeCheck}
            />
            <SimpleStatCard
              value={nodes.length - onlineNodes}
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
          {view == 'grid' ? (
            <div className='grid grid-cols-2 w-full gap-4'>
              {nodes.map((node) => (
                <NodeCard key={node.id} nodeId={node.id} />
              ))}
            </div>
          ) : (
            <div>test</div>
          )}
        </>
      )}
    </div>
  );
}
