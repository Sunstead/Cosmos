import { memo } from 'react';
import { HeartPulse } from 'lucide-react';
import { UptimeBeat } from '@/generated/UptimeBeat';
import { UptimeEntry } from '@/generated/UptimeEntry';
import { CHECK_STATE, formatUptime } from '@/lib/uptime';
import { cn } from '@/lib/utils';

const SLOTS = 90;

function beatTitle(b: UptimeBeat): string {
  const when = new Date(b.at * 1000).toLocaleString();
  if (b.ok) return `${when}: up${b.latency_ms !== null ? `, ${b.latency_ms} ms` : ''}`;
  return `${when}: ${b.detail ?? 'failed'}`;
}

/**
 * The newest results as a row of bars, newest on the right. Empty slots on
 * the left until there are enough. Native titles rather than tooltip
 * components: a page can have a thousand of these.
 */
export const UptimeBar = memo(function UptimeBar({
  beats,
  slots = SLOTS,
  className,
}: {
  beats: UptimeBeat[];
  slots?: number;
  className?: string;
}) {
  const shown = beats.slice(-slots);
  const empty = slots - shown.length;
  return (
    <div
      role='img'
      aria-label={`${shown.filter((b) => b.ok).length} of the last ${shown.length} checks passed`}
      className={cn('flex h-5 items-stretch gap-px', className)}
    >
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className='min-w-0 flex-1 rounded-[1px] bg-muted' />
      ))}
      {shown.map((b) => (
        <span
          key={b.at}
          title={beatTitle(b)}
          className={cn(
            'min-w-0 flex-1 rounded-[1px]',
            b.ok ? 'bg-success/80' : 'bg-error',
          )}
        />
      ))}
    </div>
  );
});

/** A service's check in one glance: down, or its 30-day uptime. */
export function ServiceCheckChip({ check }: { check: UptimeEntry }) {
  const down = check.state === 'down';
  const title = `Uptime check: ${CHECK_STATE[check.state].label.toLowerCase()}, ${formatUptime(check.stats.month)} over 30 days`;
  if (check.state === 'paused' && !check.check.enabled) return null;
  return (
    <span
      title={title}
      className={cn(
        'flex items-center gap-1 tabular-nums',
        down ? 'text-error' : 'text-muted-foreground',
      )}
    >
      <HeartPulse className='size-3' />
      {down ? 'Down' : formatUptime(check.stats.month)}
    </span>
  );
}
