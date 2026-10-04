import { memo, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, EthernetPort, Globe, Power, SearchX, Unplug } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useHostInfo, useTailnet, useWol } from '@/api/queries';
import { PortInfo } from '@/generated/PortInfo';
import { formatBytes } from '@/lib/node-metrics';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { matchesQuery, NO_VALUE } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { NodeStatusBadge } from '@/components/node-status-badge';
import { NodeName } from '@/components/node-name';
import { TailnetSection } from '@/components/tailnet-section';
import { WolSection } from '@/components/wol-section';
import { Section } from '@/components/section';
import { StatCard, StatRow } from '@/components/stat-card';
import { TableSkeleton } from '@/components/skeletons';
import { useAwaiting } from '@/hooks/use-awaiting';
import { cn } from '@/lib/utils';
import { Button } from '@sunstead/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sunstead/ui/components/table';

interface PortRow {
  key: string;
  nodeId: string;
  container: string;
  service: string | null;
  port: PortInfo;
  url: string | null;
}

function PortsSection({
  ports,
  visible,
  multiNode,
  loading,
}: {
  ports: PortRow[];
  visible: PortRow[];
  multiNode: boolean;
  /** Containers, which the ports come from, haven't arrived yet. */
  loading: boolean;
}) {
  return (
    <Section title='Published ports' count={ports.length || undefined}>
      {ports.length === 0 && loading ? (
        <TableSkeleton columns={4} rows={2} />
      ) : ports.length === 0 ? (
        <EmptyState size='inline' icon={EthernetPort} title='No ports published to the host' />
      ) : visible.length === 0 ? (
        <EmptyState size='inline' icon={SearchX} title='No matching ports' />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead className='h-9 text-xs'>Port</TableHead>
              <TableHead className='h-9 text-xs'>Container</TableHead>
              {multiNode && <TableHead className='h-9 text-xs'>Node</TableHead>}
              <TableHead className='h-9 text-xs'>Service</TableHead>
              <TableHead className='h-9 text-xs'>
                <span className='sr-only'>Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const href = serviceHref(r.url);
              return (
                <TableRow key={r.key}>
                  <TableCell className='font-mono tabular-nums whitespace-nowrap'>
                    {r.port.public_port}
                    <span className='text-xs text-muted-foreground'>
                      {' '}
                      {'\u2192'} {r.port.private_port}/{r.port.port_type ?? 'tcp'}
                    </span>
                  </TableCell>
                  <TableCell className='max-w-48 truncate'>{r.container}</TableCell>
                  {multiNode && (
                    <TableCell>
                      <NodeName nodeId={r.nodeId} />
                    </TableCell>
                  )}
                  <TableCell className='text-muted-foreground'>{r.service ?? NO_VALUE}</TableCell>
                  <TableCell className='text-right'>
                    {href && (
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`Open ${r.container}`}
                        onClick={() => void openExternal(href)}
                      >
                        <ArrowUpRight />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

/** Interfaces listed before the rest fold away. */
const TOP_INTERFACES = 5;

/** Rate now, with the running total beneath it. */
function Traffic({ rate, total }: { rate: number; total: number }) {
  return (
    <>
      <div>{formatBytes(rate)}/s</div>
      <div className='text-2xs text-muted-foreground'>{formatBytes(total)}</div>
    </>
  );
}

const Interfaces = memo(function Interfaces({ nodeId }: { nodeId: string }) {
  const { data: host } = useHostInfo(nodeId);
  const [showAll, setShowAll] = useState(false);

  // A Mac reports a couple of dozen interfaces (anpi, awdl, utun...) that
  // carry next to nothing. The busiest few, and anything moving right now,
  // are listed; the rest fold away. Order is by lifetime traffic, which is
  // stable from one sample to the next, so rows don't jump around.
  const nets = useMemo(
    () =>
      [...(host?.nets ?? [])].sort(
        (a, b) => b.rx_total_bytes + b.tx_total_bytes - (a.rx_total_bytes + a.tx_total_bytes),
      ),
    [host?.nets],
  );
  const shown = showAll ? nets : nets.filter((n, i) => i < TOP_INTERFACES || n.rx_bps + n.tx_bps > 0);
  const folded = nets.length - nets.filter((n, i) => i < TOP_INTERFACES || n.rx_bps + n.tx_bps > 0).length;

  return (
    <Section
      data-interfaces
      title={<NodeName nodeId={nodeId} />}
      actions={<NodeStatusBadge nodeId={nodeId} />}
    >
      {!host ? (
        <TableSkeleton rows={3} columns={3} />
      ) : nets.length === 0 ? (
        <EmptyState size='inline' icon={Unplug} title='No interfaces reported' />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='h-9 text-xs'>Interface</TableHead>
                <TableHead className='h-9 text-right text-xs'>Down</TableHead>
                <TableHead className='h-9 text-right text-xs'>Up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className='tabular-nums'>
              {shown.map((n) => (
                <TableRow key={n.name}>
                  <TableCell className='max-w-40 truncate font-mono text-xs'>{n.name}</TableCell>
                  <TableCell className='text-right'>
                    <Traffic rate={n.rx_bps} total={n.rx_total_bytes} />
                  </TableCell>
                  <TableCell className='text-right'>
                    <Traffic rate={n.tx_bps} total={n.tx_total_bytes} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {folded > 0 && (
            <div className='border-t px-2 py-1'>
              <Button
                variant='ghost'
                size='sm'
                className='w-full text-muted-foreground'
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                <ChevronDown className={cn('transition-transform', showAll && 'rotate-180')} />
                {showAll ? 'Show fewer' : `Show ${folded} more`}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
});

export function NetworkPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);
  const awaitingContainers = useAwaiting(nodeContainers);
  const [query, setQuery] = useState('');
  const tailnet = useTailnet();
  const wol = useWol();

  const ports = useMemo(() => {
    const out: PortRow[] = [];
    for (const [nodeId, containers] of Object.entries(nodeContainers)) {
      for (const c of containers) {
        for (const port of c.ports) {
          if (port.public_port == null) continue;
          out.push({
            key: `${nodeId}:${c.id}:${port.private_port}:${port.public_port}:${port.port_type}`,
            nodeId,
            container: c.name,
            service: c.cosmos_service ?? null,
            port,
            url: c.cosmos_service_url ?? null,
          });
        }
      }
    }
    return out.sort((a, b) => (a.port.public_port ?? 0) - (b.port.public_port ?? 0));
  }, [nodeContainers]);

  const portNodes = new Set(ports.map((p) => p.nodeId)).size;
  const visible = ports.filter((p) =>
    matchesQuery(query, p.container, p.service, String(p.port.public_port), String(p.port.private_port)),
  );

  return (
    <>
      <PageHeader
        title='Network'
        actions={
          (ports.length > 0 || tailnet.devices.length > 0 || wol.items.length > 0) && (
            <SearchInput value={query} onChange={setQuery} placeholder='Search devices and ports' />
          )
        }
      />

      {nodes.length === 0 ? (
        <NoNodesState />
      ) : (
        <>
          <div data-testid='network-summary'>
            <StatRow>
              {tailnet.reporting.length > 0 && (
                <StatCard
                  icon={Globe}
                  label='Tailnet'
                  value={`${tailnet.devices.filter((d) => d.online).length}/${tailnet.devices.length}`}
                  sublabel='devices online'
                  loading={tailnet.loading && tailnet.devices.length === 0}
                />
              )}
              {wol.nodes.length > 0 && (
                <StatCard
                  icon={Power}
                  label='Wake-on-LAN'
                  value={`${wol.items.filter((i) => i.state === 'awake').length}/${wol.items.length}`}
                  sublabel='machines awake'
                  loading={wol.loading}
                />
              )}
              <StatCard
                icon={EthernetPort}
                label='Published ports'
                value={ports.length}
                loading={awaitingContainers && ports.length === 0}
                sublabel={portNodes > 0 ? `on ${portNodes} ${portNodes === 1 ? 'node' : 'nodes'}` : null}
              />
            </StatRow>
          </div>

          {/* Devices and ports on the left; the per-machine lists, which stay
              short, on the right. One column below @5xl. */}
          <div className='grid items-start gap-4 @5xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
            <div className='flex min-w-0 flex-col gap-4'>
              <TailnetSection tailnet={tailnet} wol={wol.items} query={query} />
              <PortsSection ports={ports} visible={visible} multiNode={nodes.length > 1} loading={awaitingContainers} />
            </div>
            <div className='flex min-w-0 flex-col gap-4'>
              <WolSection wol={wol} query={query} multiNode={nodes.length > 1} />
              {nodes.map((n) => (
                <Interfaces key={n.id} nodeId={n.id} />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
