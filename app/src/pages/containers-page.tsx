import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useContainersStore } from '@/stores/containers';
import { columns, ContainerRow } from '@/components/container-columns';
import { DataTable } from '@/components/containers-data-table';
import SimpleStatCard from '@/components/simple-stat-card';
import { Container, Cpu, MemoryStick } from 'lucide-react';
import { formatBytes } from '@/lib/node-metrics';

interface ContainerStats {
  total: number;
  active: number;
  cpuPct: number;
  memBytes: number;
}

function summarizeContainers(containers: ContainerRow[]): ContainerStats {
  const { active, cpuPct, memBytes } = containers.reduce(
    (acc, c) => ({
      active: acc.active + (c.state === 'running' ? 1 : 0),
      cpuPct: acc.cpuPct + c.cpu_pct,
      memBytes: acc.memBytes + c.mem_used_bytes,
    }),
    { active: 0, cpuPct: 0, memBytes: 0 },
  );

  return {
    total: containers.length,
    active,
    cpuPct: Math.round(cpuPct * 100) / 100,
    memBytes,
  };
}

function activeStatusColor(active: number, total: number) {
  if (active === 0) return 'error';
  if (active < total) return 'warn';
  return 'success';
}

export function ContainersPage() {
  const nodeContainers = useContainersStore((s) => s.nodeContainers);

  const containers = useMemo<ContainerRow[]>(
    () =>
      Object.entries(nodeContainers)
        .flatMap(([nodeId, list]) => list.map((c) => ({ ...c, nodeId })))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [nodeContainers],
  );

  const stats = useMemo(() => summarizeContainers(containers), [containers]);

  return (
    <>
      <PageHeader title='CONTAINERS' />
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={stats.total}
          label='Containers'
          status={`${stats.active} running`}
          statusColor={activeStatusColor(stats.active, stats.total)}
          icon={Container}
        />
        <SimpleStatCard
          value={`${stats.cpuPct}%`}
          label='Container CPU'
          status=''
          statusColor='default'
          icon={Cpu}
        />
        <SimpleStatCard
          value={formatBytes(stats.memBytes)}
          label='Container memory'
          status=''
          statusColor='default'
          icon={MemoryStick}
        />
      </div>
      <DataTable
        columns={columns}
        data={containers}
        getRowId={(row) => `${row.nodeId}:${row.id}`}
        emptyMessage='No containers found.'
        searchPlaceholder='Search containers…'
      />
    </>
  );
}
