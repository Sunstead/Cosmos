import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Boxes, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useHostInfo, useNodeMeta } from '@/api/queries';
import { useNodeStore, nodeDisplayName } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import {
  formatBytes,
  getCpuPct,
  getDiskReadMbps,
  getDiskWriteMbps,
  getMemUsagePct,
  getNetRxMbps,
  getNetTxMbps,
  getSwapUsagePct,
} from '@/lib/node-metrics';
import { secondsToDuration } from '@/lib/time';
import { PageHeader } from '@/components/page-header';
import { NodePlanet } from '@/components/node-planet';
import { NodeStatusBadge } from '@/components/node-status-badge';
import NodeOptionsDropdown from '@/components/node-options-dropdown';
import HardwareStatDisplay from '@/components/hardware-stat-display';
import { LiveValue } from '@/components/live-value';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Per-core usage, read straight off the sample. */
function CoreGrid({ nodeId }: { nodeId: string }) {
  const { data: host } = useHostInfo(nodeId);
  if (!host?.cpu_per_core.length) return null;

  return (
    <div className='flex flex-wrap gap-1'>
      {host.cpu_per_core.map((pct, i) => (
        <div
          key={i}
          title={`Core ${i}: ${Math.round(pct)}%`}
          className='h-8 w-3 rounded-sm bg-muted overflow-hidden flex items-end'
        >
          <div
            className='w-full bg-cpu transition-[height] duration-500'
            style={{ height: `${Math.min(pct, 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function NodeDetailPage({ nodeId }: { nodeId: string }) {
  const node = useNodeStore((s) => s.nodes.find((n) => n.id === nodeId));
  const meta = useNodeMeta(nodeId);
  const { data: host } = useHostInfo(nodeId);
  const containers = useContainersStore((s) => s.nodeContainers[nodeId] ?? []);

  const running = useMemo(
    () => containers.filter((c) => c.state === 'running').length,
    [containers],
  );

  if (!node) {
    return (
      <>
        <PageHeader title='NODE' />
        <p className='text-sm text-muted-foreground'>
          This node is no longer configured.{' '}
          <Link to='/nodes' className='underline'>
            Back to nodes
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={nodeDisplayName(node)}
        description={host?.hostname ?? node.url}
        actions={
          <div className='flex items-center gap-2'>
            <Button asChild variant='outline' size='sm'>
              <Link to='/nodes'>
                <ArrowLeft />
                Nodes
              </Link>
            </Button>
            <NodeOptionsDropdown nodeId={nodeId} />
          </div>
        }
      />

      {!host ? (
        <Card>
          <CardContent className='flex flex-col items-center gap-3 py-12'>
            <NodeStatusBadge nodeId={nodeId} />
            {meta?.error && (
              <p className='text-sm text-muted-foreground text-center max-w-md'>
                {meta.error}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className='flex flex-wrap items-center gap-6 py-6'>
              <NodePlanet name={host.name} className='size-24 shrink-0' />
              <div className='grid gap-x-8 gap-y-2 text-sm @2xl:grid-cols-2 flex-1 min-w-0'>
                <Spec label='Status'>
                  <NodeStatusBadge nodeId={nodeId} />
                </Spec>
                <Spec label='Uptime'>
                  <LiveValue
                    nodeId={nodeId}
                    className='tabular-nums'
                    format={(h) => secondsToDuration(h.uptime_secs)}
                  />
                </Spec>
                <Spec label='OS'>{host.os}</Spec>
                <Spec label='Kernel'>
                  <span className='font-mono text-xs'>{host.kernel}</span>
                </Spec>
                <Spec label='CPU'>
                  {host.cpu_model}{' '}
                  <span className='text-muted-foreground'>
                    ({host.cpu_physical_cores}c / {host.cpu_logical_cores}t
                    {host.cpu_freq_mhz > 0 && ` @ ${(host.cpu_freq_mhz / 1000).toFixed(1)}GHz`})
                  </span>
                </Spec>
                <Spec label='Architecture'>
                  <span className='font-mono text-xs'>{host.arch}</span>
                </Spec>
                <Spec label='Memory'>{formatBytes(host.mem_total_bytes)}</Spec>
                <Spec label='Agent'>
                  <Badge variant='outline' className='font-mono text-[10px]'>
                    {meta?.agentVersion ?? 'unknown'}
                  </Badge>
                </Spec>
              </div>
            </CardContent>
          </Card>

          <div className='grid gap-4 @4xl:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle className='label-hud text-sm text-muted-foreground'>
                  LIVE
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='cpu'
                  name='CPU'
                  color='var(--color-cpu)'
                  scale='percent'
                  format={(h) => `${getCpuPct(h)}%`}
                />
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='ram'
                  name='RAM'
                  color='var(--color-ram)'
                  scale='percent'
                  format={(h) => `${getMemUsagePct(h)}%`}
                />
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='netRx'
                  name='NET IN'
                  color='var(--color-network)'
                  format={(h) => `${getNetRxMbps(h)} Mbps`}
                />
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='netTx'
                  name='NET OUT'
                  color='var(--color-network)'
                  format={(h) => `${getNetTxMbps(h)} Mbps`}
                />
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='diskRead'
                  name='READ'
                  color='var(--color-disk)'
                  format={(h) => `${getDiskReadMbps(h)} MB/s`}
                />
                <HardwareStatDisplay
                  nodeId={nodeId}
                  metric='diskWrite'
                  name='WRITE'
                  color='var(--color-disk)'
                  format={(h) => `${getDiskWriteMbps(h)} MB/s`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='label-hud text-sm text-muted-foreground'>
                  <Cpu className='inline size-4 mr-1.5 -mt-0.5' />
                  PER-CORE
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <CoreGrid nodeId={nodeId} />
                <div className='grid grid-cols-3 gap-2 text-sm'>
                  <Metric label='Load 1m' value={host.load1.toFixed(2)} />
                  <Metric label='Load 5m' value={host.load5.toFixed(2)} />
                  <Metric label='Load 15m' value={host.load15.toFixed(2)} />
                </div>
                {host.swap_total_bytes > 0 && (
                  <div className='flex items-center gap-2 text-sm'>
                    <MemoryStick className='size-4 text-muted-foreground' />
                    <span className='flex-1'>Swap</span>
                    <span className='tabular-nums text-muted-foreground'>
                      {formatBytes(host.swap_used_bytes)} /{' '}
                      {formatBytes(host.swap_total_bytes)} ({getSwapUsagePct(host)}%)
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className='label-hud text-sm text-muted-foreground'>
                <HardDrive className='inline size-4 mr-1.5 -mt-0.5' />
                FILESYSTEMS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className='text-right'>Used</TableHead>
                    <TableHead className='text-right'>Total</TableHead>
                    <TableHead className='w-40'>Usage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {host.disk.map((d) => {
                    const pct = d.total_bytes > 0 ? (d.used_bytes / d.total_bytes) * 100 : 0;
                    return (
                      <TableRow key={d.mount}>
                        <TableCell className='font-mono text-xs'>{d.label}</TableCell>
                        <TableCell>
                          <Badge variant='outline' className='uppercase text-[10px]'>
                            {d.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatBytes(d.used_bytes)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums text-muted-foreground'>
                          {formatBytes(d.total_bytes)}
                        </TableCell>
                        <TableCell>
                          <div className='flex items-center gap-2'>
                            <div className='h-1.5 flex-1 rounded-full bg-muted overflow-hidden'>
                              <div
                                className={
                                  pct > 90
                                    ? 'h-full bg-error'
                                    : pct > 75
                                      ? 'h-full bg-warning'
                                      : 'h-full bg-success'
                                }
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className='text-xs tabular-nums w-9 text-right'>
                              {Math.round(pct)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='label-hud text-sm text-muted-foreground'>
                <Boxes className='inline size-4 mr-1.5 -mt-0.5' />
                CONTAINERS ({running}/{containers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {containers.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  No containers reported by this node.
                </p>
              ) : (
                <Button asChild variant='outline' size='sm'>
                  <Link to='/containers'>View in Containers</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex gap-2 min-w-0'>
      <span className='text-muted-foreground w-28 shrink-0'>{label}</span>
      <span className='truncate'>{children}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md border p-2'>
      <p className='text-[10px] label-hud text-muted-foreground'>{label}</p>
      <p className='tabular-nums'>{value}</p>
    </div>
  );
}

export default NodeDetailPage;
