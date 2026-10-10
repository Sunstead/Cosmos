import { Link } from '@tanstack/react-router';
import { Network } from 'lucide-react';
import { useNodeMeta, usePeers } from '@/api/queries';
import { nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { PeerState } from '@/generated/PeerState';
import { PeerStatus } from '@/generated/PeerStatus';
import { relativeTime } from '@/lib/time';
import { NO_VALUE } from '@/lib/format';
import { Section } from './section';
import { Dot, DotVariant } from './dot';
import { EmptyState } from './empty-state';

const STATE: Record<PeerState, { label: string; dot: DotVariant }> = {
  up: { label: 'Answering', dot: 'success' },
  late: { label: 'Late', dot: 'warning' },
  down: { label: 'Not answering', dot: 'error' },
  unknown: { label: 'Not heard from yet', dot: 'disabled' },
};

const iso = (secs: number | null) => (secs === null ? null : new Date(secs * 1000).toISOString());

function PeerRow({ peer, version }: { peer: PeerStatus; version: string | null }) {
  // A peer is linked when it's also a node here, by the name its agent reports.
  const node = useNodeStore((s) => s.nodes.find((n) => n.agentName === peer.name));
  const { label, dot } = STATE[peer.state];
  const how = peer.direction === 'dial' ? 'This node sends it heartbeats' : 'It sends this node heartbeats';
  const seen = relativeTime(iso(peer.last_seen));
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm'>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <Dot variant={dot} title={label} pulse={peer.state === 'up'} />
          {node ? (
            <Link to='/nodes/$nodeId' params={{ nodeId: node.id }} className='font-medium hover:underline'>
              {nodeDisplayName(node)}
            </Link>
          ) : (
            <span className='font-medium'>{peer.name}</span>
          )}
          <span className='text-xs text-muted-foreground'>{label}</span>
        </div>
        <p className='text-xs text-muted-foreground'>
          {how}
          {peer.stopping && peer.state !== 'up' && '. It said it was shutting down'}.
        </p>
        {peer.last_error && <p className='text-xs text-error'>{peer.last_error}</p>}
        {peer.version && version && peer.version !== version && (
          <p className='text-xs text-warning'>
            Runs agent {peer.version}, this node {version}. Peers are meant to match.
          </p>
        )}
      </div>
      <div className='flex gap-4 text-xs tabular-nums text-muted-foreground'>
        <span title='Last heartbeat'>{seen ?? NO_VALUE}</span>
        {peer.latency_ms !== null && <span title='Round trip'>{peer.latency_ms} ms</span>}
        {peer.version && <span className='font-mono'>v{peer.version}</span>}
      </div>
    </div>
  );
}

/** Which agents this node watches, and how they are. Hidden without peers. */
export function PeersSection({ nodeId }: { nodeId: string }) {
  const meta = useNodeMeta(nodeId);
  const { data, error } = usePeers(nodeId);
  if (!meta?.capabilities.peers) return null;
  return (
    <Section title='Peers' count={data?.peers.length || undefined} contentClassName='divide-y'>
      {error ? (
        <p className='p-4 text-sm text-error'>{error.message}</p>
      ) : data && data.peers.length === 0 ? (
        <EmptyState size='inline' icon={Network} title='No peers' />
      ) : (
        data?.peers.map((p) => <PeerRow key={p.name} peer={p} version={meta.agentVersion} />)
      )}
    </Section>
  );
}
