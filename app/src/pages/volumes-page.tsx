import { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useVolumesStore } from '@/stores/volumes';
import { columns, VolumeRow } from '@/components/volume-columns';
import { DataTable } from '@/components/containers-data-table';
import SimpleStatCard from '@/components/simple-stat-card';
import { Database, Link2, AlertTriangle } from 'lucide-react';

interface VolumeStats {
  total: number;
  inUse: number;
  unused: number;
}

function summarizeVolumes(volumes: VolumeRow[]): VolumeStats {
  const inUse = volumes.filter((v) => v.in_use_by.length > 0).length;
  return { total: volumes.length, inUse, unused: volumes.length - inUse };
}

export function VolumesPage() {
  const nodeVolumes = useVolumesStore((s) => s.nodeVolumes);
  const volumes = useMemo<VolumeRow[]>(
    () =>
      Object.entries(nodeVolumes).flatMap(([nodeId, list]) =>
        list.map((v) => ({ ...v, nodeId })),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [nodeVolumes],
  );
  const stats = useMemo(() => summarizeVolumes(volumes), [volumes]);

  return (
    <>
      <PageHeader title='VOLUMES' />
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={stats.total}
          label='Volumes'
          status={stats.unused > 0 ? `${stats.unused} unused` : 'All in use'}
          statusColor={stats.unused > 0 ? 'warn' : 'success'}
          icon={Database}
        />
        <SimpleStatCard
          value={stats.inUse}
          label='In use'
          status=''
          statusColor='default'
          icon={Link2}
        />
        <SimpleStatCard
          value={stats.unused}
          label='Unused'
          status={stats.unused > 0 ? 'Reclaimable' : ''}
          statusColor={stats.unused > 0 ? 'warn' : 'default'}
          icon={AlertTriangle}
        />
      </div>
      <DataTable
        columns={columns}
        data={volumes}
        getRowId={(row) => `${row.nodeId}:${row.name}`}
        emptyMessage='No volumes found.'
        searchPlaceholder='Search volumes…'
      />
    </>
  );
}
