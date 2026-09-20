import { GlobeCheck, GlobeOff, Server } from 'lucide-react';
import AddNode from '@/components/add-node';
import GridListToggle, { GridListView } from '@/components/grid-list-toggle';
import { NodeCard } from '@/components/node-card';
import NodeEmpty from '@/components/node-empty';
import { NodeTableRow } from '@/components/node-table-row';
import SimpleStatCard from '@/components/simple-stat-card';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useNodeStore } from '@/stores/nodes';
import { usePersistentState } from '@/hooks/use-persistent-state';

export function NodesPage() {
  // Persisted: flipping back to grid on every navigation was irritating.
  const [view, setView] = usePersistentState<GridListView>('cosmos-nodes-view', 'grid');
  const nodes = useNodeStore((s) => s.nodes);
  const onlineNodes = useNodeStore((s) => s.onlineNodes);
  const meta = useNodeStore((s) => s.meta);

  const offlineCount = nodes.length - onlineNodes;
  const needTokens = Object.values(meta).filter((m) => m.status === 'unauthorized').length;

  return (
    <>
      <PageHeader
        title='NODES'
        actions={
          <>
            <GridListToggle view={view} onViewChange={setView} />
            <AddNode />
          </>
        }
      />

      {nodes.length === 0 ? (
        <div className='flex-1 flex justify-center items-center'>
          <NodeEmpty />
        </div>
      ) : (
        <>
          <div className='flex flex-wrap gap-4 max-w-full'>
            <SimpleStatCard
              value={nodes.length}
              label='Total nodes'
              status={offlineCount === 0 ? 'All online' : `${offlineCount} offline`}
              statusColor={offlineCount === 0 ? 'success' : 'error'}
              icon={Server}
            />
            <SimpleStatCard
              value={onlineNodes}
              label='Online'
              status={onlineNodes === nodes.length ? 'Reporting' : ''}
              statusColor='success'
              icon={GlobeCheck}
            />
            <SimpleStatCard
              value={offlineCount}
              label='Offline'
              status={needTokens > 0 ? `${needTokens} need a token` : ''}
              statusColor={needTokens > 0 ? 'error' : 'default'}
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
                    <TableHead>Name</TableHead>
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

export default NodesPage;
