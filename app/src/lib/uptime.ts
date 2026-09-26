import { CertInfo } from '@/generated/CertInfo';
import { CheckState } from '@/generated/CheckState';
import { UptimeEntry } from '@/generated/UptimeEntry';
import { DotVariant } from '@/components/dot';
import { NO_VALUE } from './format';

export const CHECK_STATE: Record<CheckState, { label: string; dot: DotVariant }> = {
  up: { label: 'Up', dot: 'success' },
  down: { label: 'Down', dot: 'error' },
  failing: { label: 'Failing', dot: 'warning' },
  pending: { label: 'Waiting', dot: 'disabled' },
  paused: { label: 'Paused', dot: 'disabled' },
};

/**
 * "99.93%". Rounds down, so a single failure never reads as 100%, and
 * shows what's left at two decimals.
 */
export function formatUptime(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return NO_VALUE;
  if (fraction >= 1) return '100%';
  const pct = Math.floor(fraction * 10_000) / 100;
  return `${pct.toFixed(pct >= 99 ? 2 : 1)}%`;
}

export function uptimeTone(
  fraction: number | null | undefined,
): 'success' | 'warning' | 'error' | null {
  if (fraction === null || fraction === undefined) return null;
  if (fraction >= 0.999) return 'success';
  if (fraction >= 0.99) return 'warning';
  return 'error';
}

/** "42 ms"; a local answer can take under a millisecond. */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  return ms < 1 ? '<1 ms' : `${ms} ms`;
}

const DAY = 86_400;

/** Days until it expires, and whether renewal looks overdue (the last quarter). */
export function certStatus(
  cert: CertInfo,
  nowSecs: number,
): { days: number; overdue: boolean } {
  const left = cert.not_after - nowSecs;
  const lifetime = Math.max(1, cert.not_after - cert.not_before);
  return { days: Math.floor(left / DAY), overdue: left * 4 < lifetime };
}

/** The check that belongs to a service, from the node that runs it. */
export function serviceCheck(
  items: (UptimeEntry & { nodeId: string })[],
  nodeId: string,
  service: string,
): (UptimeEntry & { nodeId: string }) | undefined {
  return items.find((i) => i.nodeId === nodeId && i.check.id === `svc:${service}`);
}

/** Down first, then failing, then by name. */
export function compareChecks(a: UptimeEntry, b: UptimeEntry): number {
  const rank = (s: CheckState) =>
    ({ down: 0, failing: 1, up: 2, pending: 3, paused: 4 })[s];
  return (
    rank(a.state) - rank(b.state) ||
    a.check.name.localeCompare(b.check.name, undefined, { sensitivity: 'base' })
  );
}

export const INTERVALS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 3600, label: '1 hour' },
] as const;

/** "every 1m": short, for a row. */
export function intervalLabel(secs: number): string {
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}
