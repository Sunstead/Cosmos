import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Boxes, HardDrive, Layers, Server } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useVolumesStore } from '@/stores/volumes';
import { userFacingServices } from '@/lib/services';
import { formatBytes } from '@/lib/node-metrics';
import { PageHeader } from '@/components/page-header';
import { NoNodes } from '@/components/feature-state';
import { Constellation } from '@/components/constellation';
import { ClusterLoad } from '@/components/cluster-load';
import { QuickLaunchServiceButton } from '@/components/quick-launch-service-button';
import SimpleStatCard from '@/components/simple-stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dot } from '@/components/dot';
import { getServiceStatusDisplay } from '@/lib/service-utils';

export function OverviewPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const onlineNodes = useNodeStore((s) => s.onlineNodes);
  const meta = useNodeStore((s) => s.meta);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);
  const allServices = useContainersStore((s) => s.services);
  const nodeVolumes = useVolumesStore((s) => s.nodeVolumes);

  const services = useMemo(() => userFacingServices(allServices), [allServices]);

  // Every one of these was a hardcoded literal before — "1 node", "28
  // services", "2.14 TB" — while the stores already held the real values.
  const stats = useMemo(() => {
    const containers = Object.values(nodeContainers).flat();
    const running = containers.filter((c) => c.state === 'running').length;
    const volumes = Object.values(nodeVolumes).flat();
    const degraded = services.filter((s) => s.status !== 'running').length;

    return {
      containers: containers.length,
      running,
      volumes: volumes.length,
      volumesInUse: volumes.filter((v) => v.in_use_by.length > 0).length,
      services: services.length,
      degraded,
    };
  }, [nodeContainers, nodeVolumes, services]);

  const offline = nodes.length - onlineNodes;
  const unauthorized = Object.values(meta).filter((m) => m.status === 'unauthorized').length;

  if (nodes.length === 0) return <NoNodes what='your homelab at a glance' />;

  return (
    <>
      <PageHeader title='OVERVIEW' />

      <div className='flex flex-wrap gap-4'>
        <SimpleStatCard
          value={nodes.length}
          label={nodes.length === 1 ? 'Node' : 'Nodes'}
          icon={Server}
          status={
            offline === 0
              ? 'All online'
              : unauthorized > 0
                ? `${unauthorized} need a token`
                : `${offline} offline`
          }
          statusColor={offline === 0 ? 'success' : 'error'}
        />
        <SimpleStatCard
          value={stats.services}
          label={stats.services === 1 ? 'Service' : 'Services'}
          icon={Layers}
          status={stats.degraded === 0 ? 'All healthy' : `${stats.degraded} degraded`}
          statusColor={stats.degraded === 0 ? 'success' : 'warn'}
        />
        <SimpleStatCard
          value={stats.containers}
          label='Containers'
          icon={Boxes}
          status={`${stats.running} running`}
          statusColor={
            stats.containers === 0
              ? 'default'
              : stats.running === stats.containers
                ? 'success'
                : 'warn'
          }
        />
        <SimpleStatCard
          value={stats.volumes}
          label='Volumes'
          icon={HardDrive}
          status={`${stats.volumesInUse} in use`}
          statusColor='default'
        />
      </div>

      <div className='grid gap-4 @6xl:grid-cols-3'>
        <Card className='@6xl:col-span-2 overflow-hidden'>
          <CardHeader>
            <CardTitle className='label-hud text-muted-foreground text-sm'>
              CONSTELLATION
            </CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <Constellation className='h-96 w-full' />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='label-hud text-muted-foreground text-sm'>
              QUICK LAUNCH
            </CardTitle>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                Label a container with <code>cosmos.service</code> to see it here.
              </p>
            ) : (
              <div className='grid grid-cols-3 gap-2'>
                {services.slice(0, 9).map((service) => (
                  <QuickLaunchServiceButton
                    key={`${service.nodeId}:${service.key}`}
                    serviceInfo={service}
                  />
                ))}
              </div>
            )}
            {services.length > 9 && (
              <Button asChild variant='ghost' size='sm' className='mt-2 w-full'>
                <Link to='/services'>View all {services.length}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <div className='grid gap-4 @6xl:grid-cols-3'>
        <Card className='@6xl:col-span-2'>
          <CardHeader>
            <CardTitle className='label-hud text-muted-foreground text-sm'>
              RESOURCE USAGE
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {nodes.map((n) => (
              <ClusterLoad key={n.id} nodeId={n.id} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='label-hud text-muted-foreground text-sm'>
              SERVICES
            </CardTitle>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Nothing labelled yet.</p>
            ) : (
              <ul className='space-y-1.5'>
                {services.map((s) => {
                  const display = getServiceStatusDisplay(s.status);
                  return (
                    <li
                      key={`${s.nodeId}:${s.key}`}
                      className='flex items-center gap-2 text-sm'
                    >
                      <Dot variant={display.dotVariant} pulse={s.status === 'running'} />
                      <span className='flex-1 truncate'>{s.name}</span>
                      <span className='text-xs text-muted-foreground tabular-nums'>
                        {s.running}/{s.total}
                      </span>
                      <span className='text-xs text-muted-foreground tabular-nums w-16 text-right'>
                        {formatBytes(s.mem_used_bytes)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default OverviewPage;
