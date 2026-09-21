import { useMemo } from 'react';
import { EthernetPort, Network } from 'lucide-react';
import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { useHostInfo } from '@/api/queries';
import { PageHeader } from '@/components/page-header';
import { NoNodes, NothingHere } from '@/components/feature-state';
import { NodeStatusBadge } from '@/components/node-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PortInfo } from '@/generated/PortInfo';
import { formatBytes } from '@/lib/node-metrics';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { Button } from '@/components/ui/button';

interface PortRow {
  nodeId: string;
  container: string;
  service: string | null;
  port: PortInfo;
  url: string | null;
}

function portKey(r: PortRow) {
  return `${r.nodeId}:${r.container}:${r.port.private_port}:${r.port.public_port ?? 'x'}`;
}

/** Per-interface throughput for one node. */
function NodeInterfaces({ nodeId }: { nodeId: string }) {
  const { data: host } = useHostInfo(nodeId);
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          {node ? nodeDisplayName(node) : 'Node'}
          <NodeStatusBadge nodeId={nodeId} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!host || host.nets.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No interfaces reported.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Interface</TableHead>
                <TableHead className='text-right'>Down</TableHead>
                <TableHead className='text-right'>Up</TableHead>
                <TableHead className='text-right'>Total in</TableHead>
                <TableHead className='text-right'>Total out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {host.nets.map((n) => (
                <TableRow key={n.name}>
                  <TableCell className='font-mono text-xs'>{n.name}</TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatBytes(n.rx_bps)}/s
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatBytes(n.tx_bps)}/s
                  </TableCell>
                  <TableCell className='text-right tabular-nums text-muted-foreground'>
                    {formatBytes(n.rx_total_bytes)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums text-muted-foreground'>
                    {formatBytes(n.tx_total_bytes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function NetworkPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const nodeContainers = useContainersStore((s) => s.nodeContainers);

  // Port mappings have been plumbed through the agent and typed since the
  // start; nothing in the UI had ever rendered them.
  const rows = useMemo(() => {
    const out: PortRow[] = [];
    for (const [nodeId, containers] of Object.entries(nodeContainers)) {
      for (const c of containers) {
        for (const port of c.ports) {
          if (port.public_port == null) continue; // not reachable from outside
          out.push({
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

  if (nodes.length === 0) return <NoNodes what='network activity' />;

  return (
    <>
      <PageHeader
        title='NETWORK'
        description='Published container ports and per-interface throughput.'
      />

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <EthernetPort className='size-4' />
            Published ports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No containers publish a port to the host.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host port</TableHead>
                  <TableHead>Container port</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Container</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className='text-right'>URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const href = serviceHref(r.url);
                  return (
                    <TableRow key={portKey(r)}>
                      <TableCell className='font-mono tabular-nums'>
                        {r.port.public_port}
                      </TableCell>
                      <TableCell className='font-mono tabular-nums text-muted-foreground'>
                        {r.port.private_port}
                      </TableCell>
                      <TableCell>
                        <Badge variant='outline' className='uppercase text-[10px]'>
                          {r.port.port_type ?? 'tcp'}
                        </Badge>
                      </TableCell>
                      <TableCell className='truncate max-w-48'>{r.container}</TableCell>
                      <TableCell className='text-muted-foreground'>
                        {r.service ?? '—'}
                      </TableCell>
                      <TableCell className='text-right'>
                        {href ? (
                          <Button
                            variant='link'
                            className='h-auto p-0 text-xs'
                            onClick={() => openExternal(href)}
                          >
                            Open
                          </Button>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {nodes.length === 0 ? (
        <NothingHere
          icon={Network}
          title='No interfaces'
          description='Nodes will report their interfaces once connected.'
        />
      ) : (
        nodes.map((n) => <NodeInterfaces key={n.id} nodeId={n.id} />)
      )}
    </>
  );
}

export default NetworkPage;
