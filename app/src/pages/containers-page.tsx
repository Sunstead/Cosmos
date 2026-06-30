import { useMemo } from 'react';
import { useContainersStore } from '@/stores/containers';
import { columns, ContainerRow } from '@/components/container-columns';
import { DataTable } from '@/components/containers-data-table';
import SimpleStatCard from '@/components/simple-stat-card';
import { Container, Cpu, MemoryStick } from 'lucide-react';
import { formatMemoryGb } from '@/lib/service-utils';

interface ContainerStats {
  total: number;
  active: number;
  cpuPct: number;
  memMb: number;
}

function summarizeContainers(containers: ContainerRow[]): ContainerStats {
  const { active, cpuPct, memMb } = containers.reduce(
    (acc, c) => ({
      active: acc.active + (c.state === 'running' ? 1 : 0),
      cpuPct: acc.cpuPct + c.cpu_pct,
      memMb: acc.memMb + c.mem_mb,
    }),
    { active: 0, cpuPct: 0, memMb: 0 },
  );

  return {
    total: containers.length,
    active,
    cpuPct: Math.round(cpuPct * 100) / 100,
    memMb,
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
      Object.entries(nodeContainers).flatMap(([nodeId, list]) =>
        list.map((c) => ({ ...c, nodeId })),
      ),
    [nodeContainers],
  );

  const stats = useMemo(() => summarizeContainers(containers), [containers]);

  return (
    <>
      <div className='min-h-9 flex items-center'>
        <h1 className='text-muted-foreground text-xl'>CONTAINERS</h1>
      </div>
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={stats.total}
          label='CONTAINERS'
          status={`${stats.active} Active`}
          statusColor={activeStatusColor(stats.active, stats.total)}
          icon={Container}
        />
        <SimpleStatCard
          value={`${stats.cpuPct}%`}
          label='CONTAINER CPU USAGE'
          status=''
          statusColor='default'
          icon={Cpu}
        />
        <SimpleStatCard
          value={formatMemoryGb(stats.memMb)}
          label='CONTAINER MEMORY'
          status=''
          statusColor='default'
          icon={MemoryStick}
        />
      </div>
      <div className='gap-4'>
        <DataTable
          columns={columns}
          data={containers}
          getRowId={(row) => `${row.nodeId}:${row.id}`}
        />
      </div>
    </>
  );
}
