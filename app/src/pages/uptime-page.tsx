import { memo, useMemo, useState } from 'react';
import {
  HeartPulse,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  ShieldCheck,
  Trash,
} from 'lucide-react';
import {
  useNodeMeta,
  useNow,
  useUptime,
  useUptimeActions,
  UptimeItem,
} from '@/api/queries';
import { useNodeStore } from '@/stores/nodes';
import { matchesQuery } from '@/lib/format';
import { relativeTime } from '@/lib/time';
import {
  certStatus,
  CHECK_STATE,
  formatLatency,
  compareChecks,
  formatUptime,
  intervalLabel,
  uptimeTone,
} from '@/lib/uptime';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { Section } from '@/components/section';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeletons';
import { SETUP } from '@/lib/setup';
import { Dot } from '@/components/dot';
import { NodeName } from '@/components/node-name';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { UptimeBar } from '@/components/uptime-bar';
import { UptimeCheckDialog } from '@/components/uptime-check-dialog';
import { NodeSelect } from '@/components/node-select';
import { ALL_NODES, useNodeScope } from '@/hooks/use-node-scope';
import { Button } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';

type Filter = 'all' | 'down' | 'custom';

const TONE_TEXT = {
  success: 'text-foreground',
  warning: 'text-warning',
  error: 'text-error',
} as const;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_TEXT | null;
}) {
  return (
    <div className='min-w-14 text-right'>
      <div
        className={cn(
          'text-sm tabular-nums',
          tone ? TONE_TEXT[tone] : 'text-muted-foreground',
        )}
      >
        {value}
      </div>
      <div className='text-2xs text-muted-foreground'>{label}</div>
    </div>
  );
}

function CertBadge({ item, now }: { item: UptimeItem; now: number }) {
  // Same width with or without one on wide rows, so the bars line up.
  if (!item.cert) return <span aria-hidden className='hidden w-14 @3xl:block' />;
  const { days, overdue } = certStatus(item.cert, now / 1000);
  return (
    <span
      title={`Certificate valid until ${new Date(item.cert.not_after * 1000).toLocaleDateString()}`}
      className={cn(
        'flex items-center gap-1 text-xs @3xl:w-14 @3xl:justify-end',
        overdue ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      <ShieldCheck className='size-3.5' />
      {days < 0 ? 'Expired' : `${days}d`}
    </span>
  );
}

function RowMenu({ item, nodes }: { item: UptimeItem; nodes: string[] }) {
  const meta = useNodeMeta(item.nodeId);
  const { remove } = useUptimeActions();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!meta?.capabilities.uptime_actions) return null;
  const custom = item.check.source === 'custom';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              aria-label={`Options for ${item.check.name}`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {custom && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => setRemoving(true)}>
                <Trash /> Remove
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <UptimeCheckDialog
        open={editing}
        onOpenChange={setEditing}
        nodes={nodes}
        nodeId={item.nodeId}
        check={item.check}
      />
      {custom && (
        <ConfirmDialog
          open={removing}
          onOpenChange={setRemoving}
          title={`Remove ${item.check.name}?`}
          description='Its uptime history goes with it.'
          confirmLabel='Remove'
          onConfirm={() => void remove(item.nodeId, item.check.id, item.check.name)}
        />
      )}
    </>
  );
}

function stateLine(item: UptimeItem): string | null {
  const last = item.recent.at(-1);
  if (item.state === 'paused') {
    return item.check.enabled ? 'Nothing running to check' : 'Turned off';
  }
  if ((item.state === 'down' || item.state === 'failing') && last?.detail) {
    const since = item.since
      ? relativeTime(new Date(item.since * 1000).toISOString())
      : null;
    return since ? `${last.detail}, since ${since}` : last.detail;
  }
  return null;
}

const CheckRow = memo(function CheckRow({
  item,
  nodes,
  showNode,
  now,
}: {
  item: UptimeItem;
  nodes: string[];
  showNode: boolean;
  now: number;
}) {
  const { label, dot } = CHECK_STATE[item.state];
  const line = stateLine(item);
  const paused = item.state === 'paused';

  return (
    <div data-check className='@container px-4 py-3'>
      {/* Narrow: name and menu, then the bar, then the figures. Wide: one line. */}
      <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 @3xl:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_auto_auto]'>
        <div className='col-start-1 row-start-1 min-w-0'>
          <div className='flex items-center gap-2'>
            <Dot variant={dot} pulse={item.state === 'up'} title={label} />
            <span
              className={cn('truncate font-medium', paused && 'text-muted-foreground')}
            >
              {item.check.name}
            </span>
            {showNode && (
              <span className='flex min-w-0 gap-1 text-xs text-muted-foreground'>
                from <NodeName nodeId={item.nodeId} />
              </span>
            )}
          </div>
          <div className='selectable truncate pl-4 font-mono text-xs text-muted-foreground'>
            {item.check.kind === 'tcp' ? `tcp ${item.check.target}` : item.check.target}
            <span className='font-sans'>
              {' '}
              every {intervalLabel(item.check.interval_secs)}
            </span>
          </div>
          {line && (
            <div
              className={cn(
                'truncate pl-4 text-xs',
                paused ? 'text-muted-foreground' : 'text-error',
              )}
            >
              {line}
            </div>
          )}
        </div>

        <UptimeBar
          beats={item.recent}
          className={cn(
            'col-span-2 col-start-1 row-start-2 @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1',
            paused && 'opacity-50',
          )}
        />

        <div className='col-span-2 col-start-1 row-start-3 flex items-center justify-between gap-3 @3xl:col-span-1 @3xl:col-start-3 @3xl:row-start-1 @3xl:justify-end'>
          <CertBadge item={item} now={now} />
          <Figure label='latency' value={formatLatency(item.stats.latency_ms)} />
          <Figure
            label='24h'
            value={formatUptime(item.stats.day)}
            tone={uptimeTone(item.stats.day)}
          />
          <Figure
            label='30d'
            value={formatUptime(item.stats.month)}
            tone={uptimeTone(item.stats.month)}
          />
        </div>

        <div className='col-start-2 row-start-1 @3xl:col-start-4'>
          <RowMenu item={item} nodes={nodes} />
        </div>
      </div>
    </div>
  );
});

export function UptimePage() {
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const uptime = useUptime();
  const now = useNow(60_000);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  // Joined, so the selector returns the same value until the list changes.
  const actionKey = useNodeStore((s) =>
    uptime.nodes.filter((id) => s.meta[id]?.capabilities.uptime_actions).join('|'),
  );
  const actionNodes = useMemo(() => (actionKey ? actionKey.split('|') : []), [actionKey]);
  const canAdd = actionNodes.length > 0;

  const [scope, setScope, scopeNodes] = useNodeScope('uptime', {
    capability: 'uptime',
    allowAll: true,
    initial: ALL_NODES,
  });

  const sorted = useMemo(() => [...uptime.items].sort(compareChecks), [uptime.items]);
  const visible = sorted.filter(
    (i) =>
      (scope === ALL_NODES || i.nodeId === scope) &&
      (filter === 'all' ||
        (filter === 'down' && (i.state === 'down' || i.state === 'failing')) ||
        (filter === 'custom' && i.check.source === 'custom')) &&
      matchesQuery(query, i.check.name, i.check.target, i.check.service),
  );
  const down = uptime.items.filter((i) => i.state === 'down').length;
  const showNode = nodeCount > 1 && scope === ALL_NODES;

  function body() {
    if (nodeCount === 0) return <NoNodesState />;
    if (uptime.nodes.length === 0) {
      return (
        <EmptyState
          size='page'
          icon={HeartPulse}
          title='No uptime checks'
          description='None of your nodes run them yet.'
          setup={SETUP.uptime}
        />
      );
    }
    if (uptime.error) {
      return (
        <EmptyState
          size='page'
          icon={HeartPulse}
          title='Could not load checks'
          description={uptime.error}
        />
      );
    }
    return (
      <Section
        title='Checks'
        count={uptime.items.length || undefined}
        contentClassName='divide-y'
        actions={
          down > 0 && (
            <span className='text-xs text-error'>
              {down === 1 ? '1 down' : `${down} down`}
            </span>
          )
        }
      >
        {uptime.loading && uptime.items.length === 0 ? (
          <TableSkeleton columns={3} rows={4} />
        ) : uptime.items.length === 0 ? (
          <EmptyState
            size='card'
            icon={HeartPulse}
            title='Nothing to check yet'
            description='Services with a cosmos.service.url label get a check on their own. Add one for anything else.'
            setup={SETUP.services}
          />
        ) : visible.length === 0 ? (
          <EmptyState size='inline' icon={SearchX} title='No matching checks' />
        ) : (
          visible.map((item) => (
            <CheckRow
              key={`${item.nodeId}:${item.check.id}`}
              item={item}
              nodes={actionNodes}
              showNode={showNode}
              now={now}
            />
          ))
        )}
      </Section>
    );
  }

  return (
    <>
      <PageHeader
        title='Uptime'
        count={uptime.items.length ? visible.length : undefined}
        actions={
          <>
            {uptime.items.length > 0 && (
              <>
                <NodeSelect value={scope} onChange={setScope} candidates={scopeNodes} allowAll />
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder='Search checks'
                />
                <SegmentedControl
                  label='Show'
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'down', label: 'Down' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
              </>
            )}
            {canAdd && (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add check
              </Button>
            )}
          </>
        }
      />
      {body()}
      <UptimeCheckDialog open={adding} onOpenChange={setAdding} nodes={actionNodes} />
    </>
  );
}
