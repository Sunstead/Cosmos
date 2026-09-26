import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Bell, CircleCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEventsStore } from '@/stores/events';
import { useNodeStore } from '@/stores/nodes';
import { useNotificationPrefs } from '@/stores/notifications';
import { mergeEvents, mergeProblems } from '@/lib/events';
import { cn } from '@/lib/utils';
import { EventItem, ProblemItem } from './event-item';
import { Hint } from './hint';

const RECENT = 5;

/**
 * Open problems at a glance, from any page. The count is problems open now;
 * the dot means warnings or errors you haven't seen on the Events page.
 */
export function EventsBell() {
  const byNode = useEventsStore((s) => s.byNode);
  const seen = useNotificationPrefs((s) => s.seen);
  const showNode = useNodeStore((s) => s.nodes.length > 1);
  const [open, setOpen] = useState(false);

  const problems = useMemo(() => mergeProblems(byNode), [byNode]);
  const recent = useMemo(() => mergeEvents(byNode).slice(0, RECENT), [byNode]);
  const unseen = useMemo(
    () =>
      Object.entries(byNode).some(([nodeId, n]) =>
        n.events.some((e) => e.id > (seen[nodeId] ?? 0) && e.severity !== 'info'),
      ),
    [byNode, seen],
  );

  if (Object.keys(byNode).length === 0) return null;

  const worst = problems[0]?.severity;
  const label = problems.length
    ? `${problems.length} open ${problems.length === 1 ? 'problem' : 'problems'}`
    : 'No open problems';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={label}>
        <PopoverTrigger asChild>
          <button
            type='button'
            aria-label={label}
            className={cn(
              'relative flex h-8 items-center gap-1.5 rounded-md px-2 text-xs tabular-nums transition-colors hover:bg-muted hover:text-foreground',
              worst === 'error' ? 'text-error' : worst === 'warning' ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            <Bell className='size-4' />
            {problems.length > 0 && problems.length}
            {unseen && (
              <span
                data-unseen
                className='absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary'
                aria-hidden='true'
              />
            )}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align='end' className='w-96 gap-0 p-0'>
        <div className='max-h-[60vh] divide-y overflow-y-auto'>
          <h2 className='label-hud px-4 py-2 text-2xs text-muted-foreground'>Open problems</h2>
          {problems.length === 0 ? (
            <div className='flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground'>
              <CircleCheck className='size-4 text-success' />
              Nothing needs attention.
            </div>
          ) : (
            problems.map((p) => <ProblemItem key={`${p.nodeId}:${p.key}`} problem={p} showNode={showNode} />)
          )}
          {recent.length > 0 && (
            <>
              <h2 className='label-hud px-4 py-2 text-2xs text-muted-foreground'>Recent</h2>
              {recent.map((e) => (
                <EventItem key={`${e.nodeId}:${e.id}`} event={e} showNode={showNode} relative />
              ))}
            </>
          )}
        </div>
        <Link
          to='/events'
          onClick={() => setOpen(false)}
          className='border-t px-4 py-2 text-center text-xs text-muted-foreground hover:bg-muted hover:text-foreground'
        >
          All events
        </Link>
      </PopoverContent>
    </Popover>
  );
}
