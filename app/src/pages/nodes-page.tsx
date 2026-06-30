import AddNode from '@/components/add-node';
import GridListToggle, { GridListView } from '@/components/grid-list-toggle';
import { NodeCard } from '@/components/node-card';
import NodeEmpty from '@/components/node-empty';
import NodeTableRow from '@/components/node-table-row';
import SimpleStatCard from '@/components/simple-stat-card';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNodeStore } from '@/stores/nodes';
import { GlobeCheck, GlobeOff, Server } from 'lucide-react';
import { useState } from 'react';

export function NodesPage() {
  const [view, setView] = useState<GridListView>('grid');
  const nodes = useNodeStore((s) => s.nodes);
  const onlineNodes = useNodeStore((s) => s.onlineNodes);
  const offlineCount = nodes.length - onlineNodes;

  return (
    <>
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
              value={nodes.length}
              label='TOTAL NODES'
              status={
                offlineCount === 0 ? 'All Online' : `${offlineCount} Offline`
              }
              statusColor={offlineCount === 0 ? 'success' : 'error'}
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
              value={offlineCount}
              label='OFFLINE'
              status=''
              statusColor='default'
              icon={GlobeOff}
            />
          </div>
          {view === 'grid' ? (
            <div className='grid grid-cols-1 @6xl:grid-cols-2 w-full gap-4'>
              {nodes.map((node) => (
                <NodeCard key={node.id} nodeId={node.id} />
              ))}
            </div>
          ) : (
            <Card className='p-0'>
              <Table className='table-fixed'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12' />
                    <TableHead className=''>Name</TableHead>
                    <TableHead className='min-w-20'>CPU</TableHead>
                    <TableHead className='min-w-36'>Memory</TableHead>
                    <TableHead className='min-w-36'>Network</TableHead>
                    <TableHead className='min-w-36'>Disk I/O</TableHead>
                    <TableHead className='min-w-32'>Uptime</TableHead>
                    <TableHead className='w-28' />
                    <TableHead className='w-14' />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nodes.map((node) => (
                    <NodeTableRow key={node.id} nodeId={node.id} />
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
