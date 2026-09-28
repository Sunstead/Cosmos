import { memo, useState } from 'react';
import { LoaderCircle, MoreHorizontal, Pencil, Plus, Power, Trash } from 'lucide-react';
import { useNodeMeta, useNow, useTick, useWolActionNodes, useWolActions, WolItem, WolView } from '@/api/queries';
import { WolState } from '@/generated/WolState';
import { relativeTime } from '@/lib/time';
import { matchesQuery } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from '@/components/section';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/skeletons';
import { SETUP } from '@/lib/setup';
import { Dot, DotVariant } from '@/components/dot';
import { NodeName } from '@/components/node-name';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { WolTargetDialog } from '@/components/wol-target-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATE: Record<WolState, { label: string; dot: DotVariant }> = {
  awake: { label: 'Awake', dot: 'success' },
  asleep: { label: 'Asleep', dot: 'disabled' },
  waking: { label: 'Waking', dot: 'warning' },
  did_not_wake: { label: 'Did not wake', dot: 'error' },
  unknown: { label: 'Unknown', dot: 'disabled' },
};

function StateCell({ item }: { item: WolItem }) {
  const now = useNow(1_000);
  const { label, dot } = STATE[item.state];
  if (item.state === 'waking') {
    const elapsed = item.last_wake ? Math.max(0, Math.round(now / 1000 - item.last_wake.at)) : 0;
    return (
      <span className='flex items-center gap-2 text-warning'>
        <LoaderCircle className='size-3.5 animate-spin' /> Waking, {elapsed}s
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-2', item.state !== 'awake' && 'text-muted-foreground')}>
      <Dot variant={dot} /> {label}
    </span>
  );
}

/** The most useful single line of history. */
function lastLine(item: WolItem): string | null {
  const w = item.last_wake;
  if (w && w.woke !== null) {
    const when = relativeTime(new Date(w.at * 1000).toISOString());
    return w.woke
      ? `Woke in ${w.took_secs ?? 0}s, ${when}, by ${w.by}`
      : `Wake failed ${when}, by ${w.by}`;
  }
  if (item.state !== 'awake' && item.last_seen) return `Seen ${relativeTime(item.last_seen)}`;
  return null;
}

/** Wake button with the right label and state for this machine. */
export function WakeButton({ item, size = 'sm' }: { item: WolItem; size?: 'sm' | 'xs' }) {
  const meta = useNodeMeta(item.nodeId);
  const { wake, pending } = useWolActions();
  if (!meta?.capabilities.wol_actions) return null;

  const busy = pending === `wake:${item.nodeId}:${item.target.id}` || item.state === 'waking';
  return (
    <Button
      variant={item.state === 'awake' ? 'ghost' : 'outline'}
      size={size}
      disabled={busy}
      onClick={() => void wake(item.nodeId, item.target.id, item.target.name)}
      aria-label={`Wake ${item.target.name}`}
    >
      {busy ? <LoaderCircle className='animate-spin' /> : <Power />}
      Wake
    </Button>
  );
}

function RowMenu({ item }: { item: WolItem }) {
  const meta = useNodeMeta(item.nodeId);
  const { remove } = useWolActions();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!meta?.capabilities.wol_actions) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label={`Options for ${item.target.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant='destructive' onSelect={() => setRemoving(true)}>
            <Trash /> Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <WolTargetDialog open={editing} onOpenChange={setEditing} nodeId={item.nodeId} target={item.target} />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${item.target.name}?`}
        description='Cosmos will stop offering to wake it. The machine itself is not affected.'
        confirmLabel='Remove'
        onConfirm={() => void remove(item.nodeId, item.target.id, item.target.name)}
      />
    </>
  );
}

export const WolSection = memo(function WolSection({
  wol,
  query,
  multiNode,
}: {
  wol: WolView;
  query: string;
  multiNode: boolean;
}) {
  // The waking counter and "5m ago" both need to move between polls.
  useTick(wol.items.some((i) => i.state === 'waking') ? 1_000 : 60_000);
  const [adding, setAdding] = useState(false);
  const canAdd = useWolActionNodes().length > 0;

  const visible = wol.items.filter((i) => matchesQuery(query, i.target.name, i.target.mac));

  const body = () => {
    if (wol.nodes.length === 0) {
      return (
        <EmptyState
          size='inline'
          icon={Power}
          title='Wake-on-LAN not enabled'
          description='No agent has it turned on.'
          setup={SETUP.wol}
        />
      );
    }
    if (wol.error) return <EmptyState size='inline' icon={Power} title='Could not load' description={wol.error} />;
    if (wol.loading && wol.items.length === 0) return <TableSkeleton columns={3} rows={2} />;
    if (wol.items.length === 0) {
      return (
        <EmptyState
          size='inline'
          icon={Power}
          title='No machines yet'
          description={canAdd ? 'Add one to wake it from here.' : undefined}
          setup={SETUP.wolWindows}
        />
      );
    }
    if (visible.length === 0) return <EmptyState size='inline' icon={Power} title='No matching machines' />;

    return (
      <Table>
        <TableHeader>
          <TableRow className='hover:bg-transparent'>
            <TableHead className='h-9 text-xs'>Machine</TableHead>
            {multiNode && <TableHead className='h-9 text-xs'>Node</TableHead>}
            <TableHead className='h-9 text-xs'>State</TableHead>
            <TableHead className='h-9 text-xs'>
              <span className='sr-only'>Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => (
            <TableRow key={`${item.nodeId}:${item.target.id}`}>
              <TableCell>
                <div className='font-medium'>{item.target.name}</div>
                <div className='selectable font-mono text-xs text-muted-foreground'>{item.target.mac}</div>
              </TableCell>
              {multiNode && (
                <TableCell>
                  <NodeName nodeId={item.nodeId} />
                </TableCell>
              )}
              <TableCell>
                <div className='whitespace-nowrap'>
                  <StateCell item={item} />
                </div>
                {lastLine(item) && <div className='pl-4 text-xs text-muted-foreground'>{lastLine(item)}</div>}
              </TableCell>
              <TableCell>
                <div className='flex items-center justify-end gap-1'>
                  <WakeButton item={item} />
                  <RowMenu item={item} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <>
      <Section
        title='Wake-on-LAN'
        count={wol.items.length || undefined}
        actions={
          canAdd && (
            <Button variant='ghost' size='sm' onClick={() => setAdding(true)}>
              <Plus /> Add
            </Button>
          )
        }
      >
        {body()}
      </Section>
      <WolTargetDialog open={adding} onOpenChange={setAdding} />
    </>
  );
});
