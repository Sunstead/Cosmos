import { memo, useMemo, useState } from 'react';
import { ArrowUpRight, EthernetPort, SearchX, Unplug } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useHostInfo } from '@/api/queries';
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
import { Section } from '@/components/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PortRow {
  key: string;
  nodeId: string;
  container: string;
  service: string | null;
  port: PortInfo;
  url: string | null;
}

const Interfaces = memo(function Interfaces({ nodeId }: { nodeId: string }) {
  const { data: host } = useHostInfo(nodeId);

  return (
    <Section title={<NodeName nodeId={nodeId} />} actions={<NodeStatusBadge nodeId={nodeId} />}>
      {!host || host.nets.length === 0 ? (
        <EmptyState size='inline' icon={Unplug} title='No interfaces reported' />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead className='h-9 text-xs'>Interface</TableHead>
              <TableHead className='h-9 text-right text-xs'>Down</TableHead>
              <TableHead className='h-9 text-right text-xs'>Up</TableHead>
              <TableHead className='h-9 text-right text-xs'>Received</TableHead>
              <TableHead className='h-9 text-right text-xs'>Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className='tabular-nums'>
            {host.nets.map((n) => (
              <TableRow key={n.name}>
                <TableCell className='font-mono text-xs'>{n.name}</TableCell>
                <TableCell className='text-right'>{formatBytes(n.rx_bps)}/s</TableCell>
                <TableCell className='text-right'>{formatBytes(n.tx_bps)}/s</TableCell>
                <TableCell className='text-right text-muted-foreground'>
                  {formatBytes(n.rx_total_bytes)}
                </TableCell>
                <TableCell className='text-right text-muted-foreground'>
                  {formatBytes(n.tx_total_bytes)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
});

export function NetworkPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);
  const [query, setQuery] = useState('');

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

  const visible = ports.filter((p) =>
    matchesQuery(query, p.container, p.service, String(p.port.public_port), String(p.port.private_port)),
  );

  return (
    <>
      <PageHeader
        title='Network'
        actions={
          ports.length > 0 && (
            <SearchInput value={query} onChange={setQuery} placeholder='Search ports' />
          )
        }
      />

      {nodes.length === 0 ? (
        <NoNodesState />
      ) : (
        <>
          <Section title='Published ports' count={ports.length || undefined}>
            {ports.length === 0 ? (
              <EmptyState size='inline' icon={EthernetPort} title='No ports published to the host' />
            ) : visible.length === 0 ? (
              <EmptyState size='inline' icon={SearchX} title='No matching ports' />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead className='h-9 text-xs'>Host port</TableHead>
                    <TableHead className='h-9 text-xs'>Container port</TableHead>
                    <TableHead className='h-9 text-xs'>Protocol</TableHead>
                    <TableHead className='h-9 text-xs'>Container</TableHead>
                    {nodes.length > 1 && <TableHead className='h-9 text-xs'>Node</TableHead>}
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
                        <TableCell className='font-mono tabular-nums'>{r.port.public_port}</TableCell>
                        <TableCell className='font-mono tabular-nums text-muted-foreground'>
                          {r.port.private_port}
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline' className='text-2xs uppercase'>
                            {r.port.port_type ?? 'tcp'}
                          </Badge>
                        </TableCell>
                        <TableCell className='max-w-48 truncate'>{r.container}</TableCell>
                        {nodes.length > 1 && (
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

          <div className='grid gap-4 @5xl:grid-cols-2'>
            {nodes.map((n) => (
              <Interfaces key={n.id} nodeId={n.id} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
