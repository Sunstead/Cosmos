import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Boxes, ChevronRight, Database, Hexagon, Server } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useVolumesStore } from '@/stores/volumes';
import { useAwaiting } from '@/hooks/use-awaiting';
import { userFacingServices } from '@/lib/services';
import { getServiceStatusDisplay } from '@/lib/service-utils';
import { PageHeader } from '@/components/page-header';
import { NoNodesState } from '@/components/empty-state';
import { Constellation } from '@/components/constellation';
import { ClusterLoad } from '@/components/cluster-load';
import { QuickLaunchServiceButton } from '@/components/quick-launch-service-button';
import { StatCard, StatRow } from '@/components/stat-card';
import { Section } from '@/components/section';
import { GetStarted, useSetupSteps } from '@/components/get-started';
import { Dot } from '@/components/dot';
import { ServiceIcon } from '@/lib/service-icons';
import { useUptime } from '@/api/queries';
import { serviceCheck } from '@/lib/uptime';
import { ServiceCheckChip } from '@/components/uptime-bar';

const QUICK_LAUNCH_MAX = 9;

export function OverviewPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const onlineNodes = useNodeStore((s) => s.onlineNodes);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);
  const allServices = useContainersStore((s) => s.services);
  const nodeVolumes = useVolumesStore((s) => s.nodeVolumes);
  const awaitingContainers = useAwaiting(nodeContainers);
  const awaitingVolumes = useAwaiting(nodeVolumes);
  // Only nodes that have given up count as offline; connecting is not a fault.
  const down = useNodeStore((s) =>
    s.nodes.filter((n) => ['offline', 'unauthorized'].includes(s.meta[n.id]?.status ?? '')).length,
  );
  const steps = useSetupSteps();
  const uptime = useUptime(60_000);

  const services = useMemo(() => userFacingServices(allServices), [allServices]);

  const stats = useMemo(() => {
    const containers = Object.values(nodeContainers).flat();
    const volumes = Object.values(nodeVolumes).flat();
    return {
      containers: containers.length,
      running: containers.filter((c) => c.state === 'running').length,
      volumes: volumes.length,
      volumesInUse: volumes.filter((v) => v.in_use_by.length > 0).length,
      // Running, with an uptime check that isn't down.
      healthy: services.filter(
        (s) => s.status === 'running' && serviceCheck(uptime.items, s.nodeId, s.key)?.state !== 'down',
      ).length,
    };
  }, [nodeContainers, nodeVolumes, services, uptime.items]);

  if (nodes.length === 0) {
    return (
      <>
        <PageHeader title='Overview' />
        <NoNodesState />
      </>
    );
  }

  const setupDone = steps.every((s) => s.done);
  const launchable = services.filter((s) => s.url).slice(0, QUICK_LAUNCH_MAX);

  return (
    <>
      <PageHeader title='Overview' />

      <StatRow>
        <StatCard
          icon={Server}
          label='Nodes'
          value={`${onlineNodes} / ${nodes.length}`}
          sublabel={down ? `${down} offline` : null}
          tone='error'
        />
        <StatCard
          icon={Hexagon}
          label='Services'
          value={`${stats.healthy} / ${services.length}`}
          sublabel={services.length - stats.healthy ? `${services.length - stats.healthy} degraded` : null}
          tone='warning'
          loading={awaitingContainers && stats.containers === 0}
        />
        <StatCard
          icon={Boxes}
          label='Containers'
          value={`${stats.running} / ${stats.containers}`}
          loading={awaitingContainers && stats.containers === 0}
        />
        <StatCard
          icon={Database}
          label='Volumes'
          value={`${stats.volumesInUse} / ${stats.volumes}`}
          loading={awaitingVolumes && stats.volumes === 0}
        />
      </StatRow>

      <div className='grid gap-4 @5xl:grid-cols-3'>
        <Section title='Constellation' className='@5xl:col-span-2' contentClassName='p-0'>
          <Constellation className='aspect-[2/1] max-h-[28rem] min-h-64 w-full overflow-hidden rounded-b-xl' />
        </Section>

        <div className='flex flex-col gap-4'>
          {!setupDone && <GetStarted steps={steps} />}
          {launchable.length > 0 && (
            <Section
              title='Quick launch'
              actions={
                <Link to='/services' className='flex items-center text-xs text-muted-foreground hover:text-foreground'>
                  All <ChevronRight className='size-3.5' />
                </Link>
              }
              contentClassName='grid grid-cols-3 gap-2 p-3'
            >
              {launchable.map((s) => (
                <QuickLaunchServiceButton key={`${s.nodeId}:${s.key}`} serviceInfo={s} />
              ))}
            </Section>
          )}
        </div>
      </div>

      <div className='grid gap-4 @5xl:grid-cols-3'>
        <Section
          title='Resource usage'
          className={services.length ? '@5xl:col-span-2' : '@5xl:col-span-3'}
          contentClassName='divide-y'
        >
          {nodes.map((n) => (
            <ClusterLoad key={n.id} nodeId={n.id} />
          ))}
        </Section>

        {services.length > 0 && (
          <Section title='Service health' count={services.length} contentClassName='max-h-80 divide-y overflow-auto'>
            {services.map((s) => {
              const status = getServiceStatusDisplay(s.status);
              const check = serviceCheck(uptime.items, s.nodeId, s.key);
              const unreachable = check?.state === 'down';
              return (
                <div key={`${s.nodeId}:${s.key}`} className='flex items-center gap-3 px-4 py-2 text-sm'>
                  <ServiceIcon service={s.key} size={18} />
                  <span className='min-w-0 flex-1 truncate'>{s.name}</span>
                  {check && (
                    <span className='text-xs'>
                      <ServiceCheckChip check={check} />
                    </span>
                  )}
                  <span className='text-xs tabular-nums text-muted-foreground'>
                    {s.running}/{s.total}
                  </span>
                  <Dot
                    variant={unreachable ? 'error' : status.dotVariant}
                    title={unreachable ? 'Down' : status.label}
                    pulse={s.status === 'running' && !unreachable}
                  />
                </div>
              );
            })}
          </Section>
        )}
      </div>
    </>
  );
}
