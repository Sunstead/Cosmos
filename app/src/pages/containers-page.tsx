import { useMemo, useState } from 'react';
import { Box, Container, Cpu, MemoryStick, SearchX } from 'lucide-react';
import { useContainersStore } from '@/stores/containers';
import { useAwaiting } from '@/hooks/use-awaiting';
import { useNodeStore } from '@/stores/nodes';
import { formatBytes } from '@/lib/node-metrics';
import { matchesQuery } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { StatCard, StatRow } from '@/components/stat-card';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { DataTable } from '@/components/data-table';
import { containerColumns, ContainerRow } from '@/components/container-columns';

type Filter = 'all' | 'running' | 'stopped';

export function ContainersPage() {
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);
  const awaiting = useAwaiting(nodeContainers);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = useMemo<ContainerRow[]>(
    () =>
      Object.entries(nodeContainers)
        .flatMap(([nodeId, list]) => list.map((c) => ({ ...c, nodeId })))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [nodeContainers],
  );

  const visible = useMemo(
    () =>
      all.filter((c) => {
        if (filter === 'running' && c.state !== 'running') return false;
        if (filter === 'stopped' && c.state === 'running') return false;
        return matchesQuery(query, c.name, c.image, c.cosmos_service, c.compose_project);
      }),
    [all, filter, query],
  );

  const stats = useMemo(() => {
    const running = all.filter((c) => c.state === 'running');
    return {
      running: running.length,
      cpu: running.reduce((s, c) => s + c.cpu_pct, 0),
      mem: running.reduce((s, c) => s + c.mem_used_bytes, 0),
    };
  }, [all]);

  const columns = useMemo(() => containerColumns(nodeCount > 1), [nodeCount]);
  const filtered = query !== '' || filter !== 'all';

  return (
    <>
      <PageHeader
        title='Containers'
        count={all.length ? visible.length : undefined}
        actions={
          all.length > 0 && (
            <>
              <SearchInput value={query} onChange={setQuery} placeholder='Search containers' />
              <SegmentedControl
                label='Filter by state'
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'running', label: 'Running' },
                  { value: 'stopped', label: 'Stopped' },
                ]}
              />
            </>
          )
        }
      />

      {nodeCount === 0 ? (
        <NoNodesState />
      ) : (
        <>
          {all.length > 0 && (
            <StatRow>
              <StatCard
                icon={Container}
                label='Running'
                value={`${stats.running} / ${all.length}`}
                sublabel={all.length - stats.running ? `${all.length - stats.running} stopped` : null}
                tone='warning'
              />
              <StatCard icon={Cpu} label='CPU' value={`${stats.cpu.toFixed(1)}%`} />
              <StatCard icon={MemoryStick} label='Memory' value={formatBytes(stats.mem)} />
            </StatRow>
          )}
          <DataTable
            columns={columns}
            data={visible}
            loading={awaiting}
            getRowId={(r) => `${r.nodeId}:${r.id}`}
            empty={
              filtered ? (
                <EmptyState size='inline' icon={SearchX} title='No matching containers' />
              ) : (
                <EmptyState
                  icon={Box}
                  title='No containers'
                  description='Nothing is running under Docker on your nodes.'
                />
              )
            }
          />
        </>
      )}
    </>
  );
}
