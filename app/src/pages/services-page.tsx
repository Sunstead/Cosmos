import { useMemo, useState } from 'react';
import { Hexagon, Layers } from 'lucide-react';
import { ServiceCard } from '@/components/service-card';
import { PageHeader } from '@/components/page-header';
import { NoNodes, NothingHere } from '@/components/feature-state';
import SimpleStatCard from '@/components/simple-stat-card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useContainersStore } from '@/stores/containers';
import { useNodeStore } from '@/stores/nodes';
import { ServiceStatus, userFacingServices } from '@/lib/services';

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Degraded', value: 'partial' },
  { label: 'Stopped', value: 'stopped' },
] as const;

export function ServicesPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const allServices = useContainersStore((s) => s.services);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ServiceStatus>('all');

  // `system` marks infrastructure — Caddy, Postgres, Redis, Tailscale all
  // carry it. The magic string used to be repeated in two pages.
  const services = useMemo(() => userFacingServices(allServices), [allServices]);

  const stats = useMemo(
    () => ({
      total: services.length,
      running: services.filter((s) => s.status === 'running').length,
      degraded: services.filter((s) => s.status !== 'running').length,
    }),
    [services],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return services.filter((s) => {
      if (status !== 'all' && s.status !== status) return false;
      if (!needle) return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        s.key.toLowerCase().includes(needle) ||
        (s.description?.toLowerCase().includes(needle) ?? false) ||
        s.containers.some((c) => c.name.toLowerCase().includes(needle))
      );
    });
  }, [services, query, status]);

  if (nodes.length === 0) return <NoNodes what='your services' />;

  return (
    <>
      <PageHeader
        title='SERVICES'
        actions={
          <div className='flex items-center gap-2'>
            <Input
              placeholder='Search services…'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className='w-56'
            />
            <div className='flex rounded-md border p-0.5'>
              {FILTERS.map((f) => (
                <Button
                  key={f.value}
                  size='sm'
                  variant={status === f.value ? 'secondary' : 'ghost'}
                  className='px-2.5 h-7 text-xs'
                  onClick={() => setStatus(f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        }
      />

      <div className='flex flex-wrap gap-4'>
        <SimpleStatCard
          value={stats.total}
          label='Services'
          icon={Layers}
          status={`across ${nodes.length} node${nodes.length === 1 ? '' : 's'}`}
          statusColor='default'
        />
        <SimpleStatCard
          value={stats.running}
          label='Running'
          icon={Hexagon}
          status={stats.degraded === 0 ? 'All healthy' : ''}
          statusColor='success'
        />
        <SimpleStatCard
          value={stats.degraded}
          label='Needs attention'
          icon={Hexagon}
          status={stats.degraded === 0 ? 'None' : 'Degraded or stopped'}
          statusColor={stats.degraded === 0 ? 'default' : 'warn'}
        />
      </div>

      {services.length === 0 ? (
        <NothingHere
          icon={Hexagon}
          title='No services detected'
          description={
            <>
              Add a <code>cosmos.service</code> label to your containers and they
              will be grouped here automatically.
            </>
          }
        />
      ) : visible.length === 0 ? (
        <NothingHere
          icon={Hexagon}
          title='No matches'
          description='No service matches the current search and filter.'
        />
      ) : (
        <div className='grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4'>
          {visible.map((service) => (
            <ServiceCard
              key={`${service.nodeId}:${service.key}`}
              serviceInfo={service}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default ServicesPage;
