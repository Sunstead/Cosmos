import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { CloudOff, Globe, SearchX } from 'lucide-react';
import { TailnetView, useTick, WolItem } from '@/api/queries';
import { Device, keyState, osLabel, primaryIp } from '@/lib/tailnet';
import { relativeTime } from '@/lib/time';
import { matchesQuery, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from '@/components/section';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeletons';
import { SETUP } from '@/lib/setup';
import { WakeButton } from '@/components/wol-section';
import { Dot } from '@/components/dot';
import { Badge } from '@sunstead/ui/components/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sunstead/ui/components/table';

function Presence({ device }: { device: Device }) {
  if (device.online) {
    return (
      <span className='flex items-center gap-2'>
        <Dot variant='success' /> Online
      </span>
    );
  }
  const seen = relativeTime(device.last_seen);
  return (
    <span className='flex items-center gap-2 text-muted-foreground'>
      <Dot variant='disabled' /> {seen ? `Seen ${seen}` : 'Offline'}
    </span>
  );
}

/** How traffic reaches the device, as a secondary line under its status. */
function Path({ device }: { device: Device }) {
  const c = device.connection;
  if (device.nodeId && device.reportedBy === device.nodeId) return <>This node</>;
  if (c.kind === 'direct') return <span title={c.endpoint}>Direct</span>;
  if (c.kind === 'relay') {
    return (
      <span className='text-warning' title='Traffic goes through a Tailscale relay'>
        Relay {c.region}
      </span>
    );
  }
  return <>Idle</>;
}

function KeyExpiry({ device }: { device: Device }) {
  const state = keyState(device);
  if (state === 'never') return <span className='text-muted-foreground'>{NO_VALUE}</span>;
  if (state === 'expired') return <span className='text-error'>Expired</span>;
  return (
    <span className={cn(state === 'expiring' ? 'text-warning' : 'text-muted-foreground')} title={device.key_expiry ?? undefined}>
      {relativeTime(device.key_expiry)}
    </span>
  );
}

/** Every device on the tailnet, as the agents' `tailscaled` sees it. */
export const TailnetSection = memo(function TailnetSection({
  tailnet,
  wol,
  query,
}: {
  tailnet: TailnetView;
  /** Wake-on-LAN targets, so a sleeping linked device gets a Wake button. */
  wol: WolItem[];
  query: string;
}) {
  // "Seen 5m ago" and key expiry drift between polls.
  useTick(60_000);
  const { devices, reporting, loading, error } = tailnet;

  const wakeFor = new Map(wol.filter((w) => w.target.tailnet_device).map((w) => [w.target.tailnet_device!, w]));
  const visible = devices.filter((d) =>
    matchesQuery(query, d.name, d.dns_name, d.os, d.user, ...d.ips),
  );

  const body = () => {
    if (reporting.length === 0) {
      return (
        <EmptyState
          size='inline'
          icon={Globe}
          title='Tailnet not enabled'
          description='No agent is reading tailscaled.'
          setup={SETUP.tailnet}
        />
      );
    }
    if (error) {
      return <EmptyState size='inline' icon={CloudOff} title='Could not read the tailnet' description={error} />;
    }
    if (loading && devices.length === 0) return <TableSkeleton columns={4} />;
    if (visible.length === 0) {
      return <EmptyState size='inline' icon={SearchX} title='No matching devices' />;
    }
    return (
      <Table>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            <TableHead className='h-9 text-xs'>Device</TableHead>
            <TableHead className='h-9 text-xs'>OS</TableHead>
            <TableHead className='h-9 text-xs'>Status</TableHead>
            <TableHead className='h-9 text-xs'>Key expiry</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((d) => (
            <TableRow key={d.id} className={cn(!d.online && 'opacity-70')}>
              <TableCell className='max-w-56'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium'>{d.name}</span>
                  {d.nodeId && (
                    <Badge
                      variant='secondary'
                      className='text-2xs'
                      render={<Link to='/nodes/$nodeId' params={{ nodeId: d.nodeId }} />}
                    >
                      Node
                    </Badge>
                  )}
                  {d.exit_node && (
                    <Badge variant='outline' className='text-2xs'>
                      Exit node
                    </Badge>
                  )}
                </div>
                <div
                  className='selectable truncate font-mono text-xs tabular-nums text-muted-foreground'
                  title={[d.dns_name, ...d.ips].join('\n')}
                >
                  {primaryIp(d) ?? d.dns_name}
                </div>
              </TableCell>
              <TableCell>{osLabel(d.os)}</TableCell>
              <TableCell className='whitespace-nowrap'>
                <div className='flex items-center gap-2'>
                  <Presence device={d} />
                  {wakeFor.has(d.id) && wakeFor.get(d.id)!.state !== 'awake' && (
                    <WakeButton item={wakeFor.get(d.id)!} size='xs' />
                  )}
                </div>
                <div className='pl-4 text-xs text-muted-foreground'>
                  <Path device={d} />
                </div>
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                <KeyExpiry device={d} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  const online = devices.filter((d) => d.online).length;
  return (
    <Section title='Tailnet' count={devices.length ? `${online}/${devices.length}` : undefined}>
      {body()}
    </Section>
  );
});
