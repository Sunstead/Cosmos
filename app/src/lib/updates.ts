import { ChangeKind } from '@/generated/ChangeKind';
import { UpdatePolicy } from '@/generated/UpdatePolicy';
import { UpdateRun } from '@/generated/UpdateRun';
import { UpdateRunState } from '@/generated/UpdateRunState';
import { UpdateUnit } from '@/generated/UpdateUnit';

export const POLICY: Record<UpdatePolicy, string> = {
  manual: 'Manual',
  patch: 'Patches automatically',
  auto: 'Automatically',
};

export const CHANGE: Record<ChangeKind, { label: string; className: string }> = {
  patch: { label: 'Patch', className: 'text-muted-foreground' },
  minor: { label: 'Minor', className: 'text-foreground' },
  major: { label: 'Major', className: 'text-warning' },
};

export const RUN_STATE: Record<
  UpdateRunState,
  { label: string; tone: 'busy' | 'ok' | 'error' }
> = {
  queued: { label: 'Queued', tone: 'busy' },
  dispatched: { label: 'Starting the workflow', tone: 'busy' },
  running: { label: 'Backing up and deploying', tone: 'busy' },
  watching: { label: 'Deployed, checking it stays up', tone: 'busy' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'error' },
  broken: { label: 'Broken after the update', tone: 'error' },
};

export function isRunning(run: UpdateRun | null | undefined): boolean {
  return !!run && RUN_STATE[run.state].tone === 'busy';
}

/** What the Update button offers: the newest allowed tag. */
export function offered(unit: UpdateUnit): string | null {
  return unit.available?.tag ?? null;
}

/** Updates first (biggest change first), then running ones, then the rest by name. */
export function compareUnits(a: UpdateUnit, b: UpdateUnit): number {
  const rank = (u: UpdateUnit) => {
    if (u.run && (u.run.state === 'broken' || isRunning(u.run))) return 0;
    if (u.available) return { major: 1, minor: 2, patch: 3 }[u.available.change];
    return 4;
  };
  return (
    rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

/** When an automatic update would apply, for a unit whose policy allows one. */
export function autoNote(
  unit: UpdateUnit,
  minAgeDays: number,
  nowSecs: number,
): string | null {
  if (unit.paused || unit.policy === 'manual') return null;
  const target =
    unit.policy === 'patch'
      ? (unit.patch ?? (unit.available?.change === 'patch' ? unit.available : null))
      : unit.available;
  if (!target) return null;
  const ready = target.first_seen + minAgeDays * 86_400;
  if (ready <= nowSecs) return `${target.tag} applies after the next nightly backup`;
  const days = Math.ceil((ready - nowSecs) / 86_400);
  return `${target.tag} applies automatically in ${days === 1 ? '1 day' : `${days} days`}, after a nightly backup`;
}
