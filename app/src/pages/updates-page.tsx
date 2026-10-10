import { memo, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  SearchX,
  TriangleAlert,
} from 'lucide-react';
import {
  useNodeMeta,
  useNow,
  useUpdateActions,
  useUpdates,
  UpdateItem,
} from '@/api/queries';
import { nodeDisplayName, useNodeStore } from '@/stores/nodes';
import { UpdateCandidate } from '@/generated/UpdateCandidate';
import { UpdatePolicy } from '@/generated/UpdatePolicy';
import { UpdateRun } from '@/generated/UpdateRun';
import { UpdatesResponse } from '@/generated/UpdatesResponse';
import { matchesQuery } from '@/lib/format';
import { relativeTime } from '@/lib/time';
import { openExternal } from '@/lib/open-external';
import {
  autoNote,
  CHANGE,
  compareUnits,
  groupUnits,
  UnitGroup,
  isRunning,
  POLICY,
  RUN_STATE,
  runText,
} from '@/lib/updates';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { SegmentedControl } from '@/components/segmented-control';
import { Section } from '@/components/section';
import { EmptyState, NoNodesState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeletons';
import { SetupHint } from '@/components/setup-hint';
import { SETUP } from '@/lib/setup';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { NodeName } from '@/components/node-name';
import { Alert, AlertDescription, AlertTitle } from '@sunstead/ui/components/alert';
import { Button } from '@sunstead/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sunstead/ui/components/select';

type Filter = 'all' | 'available' | 'automatic';

const iso = (secs: number) => new Date(secs * 1000).toISOString();

function RunLine({ run }: { run: UpdateRun }) {
  const { tone } = RUN_STATE[run.state];
  const watching = run.state === 'watching';
  const [now, setNow] = useState(() => Date.now() / 1000);
  // The watch's countdown moves on its own; nothing else on the line does.
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 15_000);
    return () => clearInterval(timer);
  }, [watching]);
  const when = watching ? null : relativeTime(iso(run.finished_at ?? run.requested_at));
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 text-xs',
        tone === 'error'
          ? 'text-error'
          : tone === 'ok'
            ? 'text-muted-foreground'
            : 'text-warning',
      )}
    >
      {tone === 'busy' ? (
        <LoaderCircle className='mt-px size-3.5 shrink-0 animate-spin' />
      ) : tone === 'ok' ? (
        <CircleCheck className='mt-px size-3.5 shrink-0 text-success' />
      ) : (
        <CircleX className='mt-px size-3.5 shrink-0' />
      )}
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5'>
        <span>
          {runText(run, now)}
          {tone !== 'busy' && when && `, ${when}`}
          {run.by !== 'auto' ? `, by ${run.by}` : ', automatically'}
        </span>
        {run.detail && <span className='w-full text-muted-foreground'>{run.detail}</span>}
        {run.run_url && (
          <button
            type='button'
            onClick={() => void openExternal(run.run_url!)}
            className='flex items-center gap-0.5 text-muted-foreground hover:text-foreground'
          >
            Workflow run <ArrowUpRight className='size-3' />
          </button>
        )}
      </div>
    </div>
  );
}

function UpdateButton({
  item,
  target,
  label = 'Update',
  variant = 'default',
}: {
  item: UpdateItem;
  target: UpdateCandidate | null;
  label?: string;
  variant?: 'default' | 'outline';
}) {
  const actions = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  if (!target) return null;
  const busy = isRunning(item.run);

  const steps = [
    item.backup && 'backs up its database',
    'commits the new tag to the repository',
    'deploys it',
  ].filter(Boolean) as string[];
  return (
    <>
      <Button
        size='sm'
        variant={variant}
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title={`Update ${item.name} to ${target.tag}?`}
        description={
          <div className='space-y-2'>
            <p>
              The update workflow {steps.slice(0, -1).join(', ')} and {steps.at(-1)}.
              Cosmos then watches it for a few minutes, and pauses automatic updates if it
              breaks.
            </p>
            {target.change === 'major' && (
              <p className='flex items-start gap-1.5 text-warning'>
                <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />A major version.
                Read the release notes first: some need steps of their own.
              </p>
            )}
          </div>
        }
        confirmLabel='Update'
        onConfirm={() => actions.apply(item.nodeId, item, target.tag)}
      />
    </>
  );
}

function RollbackButton({ item }: { item: UpdateItem }) {
  const actions = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  if (!item.previous || isRunning(item.run)) return null;
  return (
    <>
      <Button
        size='sm'
        variant={item.run?.state === 'broken' ? 'default' : 'ghost'}
        onClick={() => setConfirming(true)}
      >
        <RotateCcw /> Roll back
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Roll back ${item.name} to ${item.previous}?`}
        description={
          item.backup ? (
            <div className='space-y-2'>
              <p>
                {item.name} keeps its data in a database, and a newer version may have
                changed it on start. The old version may not read it.
              </p>
              <p>
                If it doesn't come back up, restore the database from the pre-update
                backup too:{' '}
                <Link to='/backups' className='underline'>
                  Backups
                </Link>
                , Restore, A database.
              </p>
            </div>
          ) : (
            `Deploys ${item.previous} again, the same way as an update.`
          )
        }
        confirmLabel='Roll back'
        onConfirm={() => actions.rollback(item.nodeId, item)}
      />
    </>
  );
}

function PolicySelect({ item }: { item: UpdateItem }) {
  const actions = useUpdateActions();
  return (
    <Select
      value={item.policy}
      items={POLICY}
      onValueChange={(v) =>
        void actions.policy(item.nodeId, item, v as UpdatePolicy).catch(() => {})
      }
    >
      <SelectTrigger
        size='sm'
        className='h-8 w-auto min-w-44'
        aria-label={`Updates for ${item.name}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(POLICY) as UpdatePolicy[]).map((p) => (
          <SelectItem key={p} value={p}>
            {POLICY[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReleaseNotes({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <button
      type='button'
      onClick={() => void openExternal(url)}
      className='flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground'
    >
      Release notes <ArrowUpRight className='size-3' />
    </button>
  );
}

/** Where a unit stands on one node, and what can be done there. */
function UnitState({
  item,
  response,
  now,
  showNode,
}: {
  item: UpdateItem;
  response: UpdatesResponse | undefined;
  now: number;
  showNode: boolean;
}) {
  const meta = useNodeMeta(item.nodeId);
  const canAct = meta?.capabilities.update_actions ?? false;
  const change = item.available ? CHANGE[item.available.change] : null;
  const note = autoNote(item, response?.min_age_days ?? 3, now / 1000);
  // Some nodes list updates without applying them (no deploy workflow).
  const listOnly = response ? !response.can_apply : false;

  return (
    <div className='flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:gap-4'>
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='flex flex-wrap items-center gap-x-2 text-sm'>
          {showNode && (
            <span className='w-20 shrink-0 text-xs font-medium'>
              <NodeName nodeId={item.nodeId} />
            </span>
          )}
          <span className='font-mono'>{item.current}</span>
          {item.available && change && (
            <>
              <ArrowRight className='size-3.5 text-muted-foreground' />
              <span className='font-mono'>{item.available.tag}</span>
              <span className={cn('text-xs', change.className)}>{change.label}</span>
            </>
          )}
          {!item.available && !item.blocked && (
            <span className='text-xs text-muted-foreground'>Up to date</span>
          )}
        </div>
        {item.held && (
          <p className='text-xs text-muted-foreground'>
            {item.held.tag} held: {item.held.reason}
          </p>
        )}
        {item.blocked && (
          <p className='text-xs text-muted-foreground'>Not updated: {item.blocked}</p>
        )}
        {item.paused && (
          <p className='text-xs text-error'>Automatic updates paused: {item.paused}</p>
        )}
        {note && !listOnly && <p className='text-xs text-muted-foreground'>{note}</p>}
        {listOnly && item.available && (
          <p className='text-xs text-muted-foreground'>
            Listed only: this node has no update workflow, so bump the tag in its repository.
          </p>
        )}
        {item.run && <RunLine run={item.run} />}
      </div>

      {canAct && !item.blocked && (
        <div className='flex flex-wrap items-center gap-2'>
          <PolicySelect item={item} />
          <RollbackButton item={item} />
          <UpdateButton
            item={item}
            target={item.patch}
            label={`Patch to ${item.patch?.tag}`}
            variant='outline'
          />
          <UpdateButton item={item} target={item.available} />
        </div>
      )}
    </div>
  );
}

/** One image, with a line per node that runs it. */
const UnitRow = memo(function UnitRow({
  group,
  byNode,
  showNode,
  now,
}: {
  group: UnitGroup<UpdateItem>;
  byNode: Record<string, UpdatesResponse>;
  showNode: boolean;
  now: number;
}) {
  const several = group.items.length > 1;
  const only = group.items[0];

  return (
    <div data-update className='space-y-2 px-4 py-3'>
      <div className='min-w-0 space-y-0.5'>
        <div className='flex flex-wrap items-center gap-x-2'>
          <span className='font-medium'>{group.name}</span>
          {showNode && !several && (
            <span className='text-xs'>
              <NodeName nodeId={only.nodeId} />
            </span>
          )}
          <ReleaseNotes url={group.notes_url} />
        </div>
        <div
          className='selectable truncate font-mono text-xs text-muted-foreground'
          title={group.images.join('\n')}
        >
          {group.images.join(', ')}
        </div>
      </div>
      <div className={cn(several && 'divide-y border-l pl-3')}>
        {group.items.map((item) => (
          <div key={item.nodeId} className={cn(several && 'py-2 first:pt-0 last:pb-0')}>
            <UnitState item={item} response={byNode[item.nodeId]} now={now} showNode={several} />
          </div>
        ))}
      </div>
    </div>
  );
});

export function UpdatesPage() {
  const nodes = useNodeStore((s) => s.nodes);
  const nodeCount = nodes.length;
  const nameOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? nodeDisplayName(n) : id;
  };
  const updates = useUpdates();
  const actions = useUpdateActions();
  const now = useNow(60_000);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [checking, setChecking] = useState(false);
  // Checking is an admin write; container_actions is exactly "admin with
  // allow_actions" after effectiveCapabilities.
  const checkKey = useNodeStore((s) =>
    updates.nodes.filter((id) => s.meta[id]?.capabilities.container_actions).join('|'),
  );

  const groups = useMemo(() => groupUnits([...updates.items].sort(compareUnits)), [updates.items]);
  const visible = groups.filter(
    (g) =>
      g.items.some(
        (u) =>
          filter === 'all' ||
          (filter === 'available' && !!u.available) ||
          (filter === 'automatic' && u.policy !== 'manual'),
      ) &&
      matchesQuery(
        query,
        g.name,
        ...g.images,
        ...g.items.flatMap((u) => [nameOf(u.nodeId), ...u.services]),
      ),
  );
  // Images with something newer, counted once however many nodes run them.
  const available = groups.filter((g) => g.items.some((u) => u.available)).length;
  const history = useMemo(
    () =>
      Object.entries(updates.byNode)
        .flatMap(([nodeId, r]) => r.history.map((h) => ({ ...h, nodeId })))
        .sort((a, b) => b.requested_at - a.requested_at)
        .slice(0, 15),
    [updates.byNode],
  );
  const responses = Object.entries(updates.byNode);
  const named = (nodeId: string, text: string) => (nodeCount > 1 ? `${nameOf(nodeId)}: ${text}` : text);
  const errors = responses.flatMap(([id, r]) => r.errors.map((e) => named(id, e)));
  const listOnly = responses.filter(([, r]) => !r.can_apply).map(([id]) => id);
  const allListOnly = responses.length > 0 && listOnly.length === responses.length;
  const expiring = responses.flatMap(([id, r]) =>
    r.token_expires_at !== null && r.token_expires_at - now / 1000 < 14 * 86_400
      ? [{ nodeId: id, at: r.token_expires_at }]
      : [],
  );
  const checked = responses.flatMap(([id, r]) => (r.checked_at !== null ? [{ nodeId: id, at: r.checked_at }] : []));

  async function checkNow() {
    setChecking(true);
    // Each failure is reported by the action; wait for every node.
    await Promise.allSettled(
      checkKey
        .split('|')
        .filter(Boolean)
        .map((id) => actions.check(id)),
    );
    setChecking(false);
  }

  function body() {
    if (nodeCount === 0) return <NoNodesState />;
    if (updates.nodes.length === 0) {
      return (
        <EmptyState
          size='page'
          icon={PackageCheck}
          title='No update checks'
          description='None of your nodes check for image updates yet.'
          setup={SETUP.updates}
        />
      );
    }
    if (updates.error) {
      return (
        <EmptyState
          size='page'
          icon={PackageCheck}
          title='Could not load updates'
          description={updates.error}
        />
      );
    }
    return (
      <>
        {allListOnly && (
          <Alert>
            <PackageCheck />
            <AlertTitle>Updates are listed, not applied</AlertTitle>
            <AlertDescription className='flex flex-wrap items-center gap-2'>
              Applying them needs the repository whose workflow deploys, and a GitHub
              token.
              <SetupHint info={SETUP.updatesApply} />
            </AlertDescription>
          </Alert>
        )}
        {!allListOnly && nodeCount > 1 && listOnly.length > 0 && (
          <p className='flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
            {listOnly.map(nameOf).join(', ')} {listOnly.length === 1 ? 'lists' : 'list'} updates
            without applying them.
            <SetupHint info={SETUP.updatesApply} />
          </p>
        )}
        {expiring.map(({ nodeId, at }) => (
          <Alert key={nodeId} className='border-warning/40'>
            <TriangleAlert className='text-warning' />
            <AlertTitle>
              {nodeCount > 1 ? `${nameOf(nodeId)}'s` : 'The'} GitHub token expires {relativeTime(iso(at))}
            </AlertTitle>
            <AlertDescription>
              Make a new one with the same permissions and put it in that server's .env.
            </AlertDescription>
          </Alert>
        ))}
        {errors.length > 0 && (
          <Alert className='border-warning/40'>
            <TriangleAlert className='text-warning' />
            <AlertTitle>Some checks failed</AlertTitle>
            <AlertDescription>{errors.join('. ')}</AlertDescription>
          </Alert>
        )}

        <Section
          title='Images'
          count={groups.length || undefined}
          contentClassName='divide-y @container'
          actions={
            checked.length > 0 && (
              <span className='text-xs text-muted-foreground'>
                {nodeCount > 1
                  ? checked.map((c) => `${nameOf(c.nodeId)} checked ${relativeTime(iso(c.at))}`).join(', ')
                  : `Checked ${relativeTime(iso(checked[0].at))}`}
              </span>
            )
          }
        >
          {updates.loading && updates.items.length === 0 ? (
            <TableSkeleton columns={3} rows={4} />
          ) : updates.items.length === 0 ? (
            <EmptyState
              size='card'
              icon={PackageCheck}
              title='No images to check yet'
              description='Containers started by Compose, with a tagged image, show up here.'
            />
          ) : visible.length === 0 ? (
            <EmptyState size='inline' icon={SearchX} title='No matching images' />
          ) : (
            visible.map((g) => (
              <UnitRow
                key={g.id}
                group={g}
                byNode={updates.byNode}
                showNode={nodeCount > 1}
                now={now}
              />
            ))
          )}
        </Section>

        {history.length > 0 && (
          <Section title='History' count={history.length} contentClassName='divide-y'>
            {history.map((h) => (
              <div key={`${h.nodeId}:${h.id}`} className='space-y-0.5 px-4 py-2.5'>
                <div className='text-sm'>
                  {updates.items.find((u) => u.nodeId === h.nodeId && u.id === h.unit)
                    ?.name ?? h.unit}{' '}
                  {nodeCount > 1 && (
                    <span className='text-xs text-muted-foreground'>on {nameOf(h.nodeId)} </span>
                  )}
                  <span className='font-mono text-xs text-muted-foreground'>
                    {h.from} to {h.to}
                  </span>
                </div>
                <RunLine run={h} />
              </div>
            ))}
          </Section>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title='Updates'
        count={updates.items.length ? available : undefined}
        actions={
          <>
            {updates.items.length > 0 && (
              <>
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder='Search images'
                />
                <SegmentedControl
                  label='Show'
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'available', label: 'Available' },
                    { value: 'automatic', label: 'Automatic' },
                  ]}
                />
              </>
            )}
            {checkKey && (
              <Button
                variant='outline'
                disabled={checking}
                onClick={() => void checkNow()}
              >
                {checking ? <LoaderCircle className='animate-spin' /> : <RefreshCw />}
                Check now
              </Button>
            )}
          </>
        }
      />
      {body()}
    </>
  );
}
