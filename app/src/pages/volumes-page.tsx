import { useMemo, useState } from 'react';
import { Database, Link2, PackageOpen, SearchX, Unlink } from 'lucide-react';
import { useVolumesStore } from '@/stores/volumes';
import { useNodeStore } from '@/stores/nodes';
import { matchesQuery } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { StatCard, StatRow } from '@/components/stat-card';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { DataTable } from '@/components/data-table';
import { volumeColumns, VolumeRow } from '@/components/volume-columns';

type Filter = 'all' | 'used' | 'unused';

export function VolumesPage() {
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const nodeVolumes = useVolumesStore((s) => s.nodeVolumes);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const all = useMemo<VolumeRow[]>(
    () =>
      Object.entries(nodeVolumes)
        .flatMap(([nodeId, list]) => list.map((v) => ({ ...v, nodeId })))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [nodeVolumes],
  );

  const visible = useMemo(
    () =>
      all.filter((v) => {
        const used = v.in_use_by.length > 0;
        if (filter === 'used' && !used) return false;
        if (filter === 'unused' && used) return false;
        return matchesQuery(query, v.name, v.compose_project, v.cosmos_service, ...v.in_use_by);
      }),
    [all, filter, query],
  );

  const inUse = all.filter((v) => v.in_use_by.length > 0).length;
  const columns = useMemo(() => volumeColumns(nodeCount > 1), [nodeCount]);
  const filtered = query !== '' || filter !== 'all';

  return (
    <>
      <PageHeader
        title='Volumes'
        count={all.length ? visible.length : undefined}
        actions={
          all.length > 0 && (
            <>
              <SearchInput value={query} onChange={setQuery} placeholder='Search volumes' />
              <SegmentedControl
                label='Filter by usage'
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'used', label: 'In use' },
                  { value: 'unused', label: 'Unused' },
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
              <StatCard icon={Database} label='Volumes' value={all.length} />
              <StatCard icon={Link2} label='In use' value={inUse} />
              <StatCard
                icon={Unlink}
                label='Unused'
                value={all.length - inUse}
                sublabel={all.length - inUse ? 'Reclaimable' : null}
                tone='warning'
              />
            </StatRow>
          )}
          <DataTable
            columns={columns}
            data={visible}
            getRowId={(r) => `${r.nodeId}:${r.name}`}
            empty={
              filtered ? (
                <EmptyState size='inline' icon={SearchX} title='No matching volumes' />
              ) : (
                <EmptyState icon={PackageOpen} title='No volumes' />
              )
            }
          />
        </>
      )}
    </>
  );
}
