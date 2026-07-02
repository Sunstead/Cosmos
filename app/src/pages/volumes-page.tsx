import { useMemo } from 'react';
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
      <div className='min-h-9 flex items-center'>
        <h1 className='text-muted-foreground text-xl'>VOLUMES</h1>
      </div>
      <div className='flex flex-wrap gap-4 max-w-full'>
        <SimpleStatCard
          value={stats.total}
          label='VOLUMES'
          status={stats.unused > 0 ? `${stats.unused} unused` : 'All in use'}
          statusColor={stats.unused > 0 ? 'warn' : 'success'}
          icon={Database}
        />
        <SimpleStatCard
          value={stats.inUse}
          label='IN USE'
          status=''
          statusColor='default'
          icon={Link2}
        />
        <SimpleStatCard
          value={stats.unused}
          label='UNUSED'
          status={stats.unused > 0 ? 'Reclaimable' : ''}
          statusColor={stats.unused > 0 ? 'warn' : 'default'}
          icon={AlertTriangle}
        />
      </div>
      <div className='gap-4'>
        <DataTable
          columns={columns}
          data={volumes}
          getRowId={(row) => `${row.nodeId}:${row.name}`}
          emptyMessage='No volumes found.'
        />
      </div>
    </>
  );
}
