import { LayoutGrid, List, SearchX } from 'lucide-react';
import { useState } from 'react';
import { NodeCard } from '@/components/node-card';
import { NodeTableHeader, NodeTableRow } from '@/components/node-table-row';
import { PageHeader } from '@/components/page-header';
import { SegmentedControl } from '@/components/segmented-control';
import { SearchInput } from '@/components/search-input';
import { AddNodeButton, EmptyState, NoNodesState } from '@/components/empty-state';
import { Card } from '@/components/ui/card';
import { Table, TableBody } from '@/components/ui/table';
import { nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { matchesQuery } from '@/lib/format';

type View = 'grid' | 'list';

export function NodesPage() {
  const [view, setView] = usePersistentState<View>('cosmos-nodes-view', 'grid');
  const [query, setQuery] = useState('');
  const nodes = useNodeStore((s) => s.nodes);
  const visible = nodes.filter((n) => matchesQuery(query, nodeDisplayName(n), n.url, n.agentName));

  return (
    <>
      <PageHeader
        title='Nodes'
        count={nodes.length ? visible.length : undefined}
        actions={
          nodes.length > 0 && (
            <>
              {nodes.length > 3 && (
                <SearchInput value={query} onChange={setQuery} placeholder='Search nodes' />
              )}
              <SegmentedControl<View>
                label='View'
                value={view}
                onChange={setView}
                options={[
                  { value: 'grid', icon: LayoutGrid, hint: 'Cards' },
                  { value: 'list', icon: List, hint: 'List' },
                ]}
              />
              <AddNodeButton />
            </>
          )
        }
      />

      {nodes.length === 0 ? (
        <NoNodesState />
      ) : visible.length === 0 ? (
        <EmptyState size='page' icon={SearchX} title='No matching nodes' />
      ) : view === 'grid' ? (
        <div className='grid gap-4 @6xl:grid-cols-2'>
          {visible.map((n) => (
            <NodeCard key={n.id} nodeId={n.id} />
          ))}
        </div>
      ) : (
        <Card className='p-0'>
          <Table>
            <NodeTableHeader />
            <TableBody>
              {visible.map((n) => (
                <NodeTableRow key={n.id} nodeId={n.id} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
