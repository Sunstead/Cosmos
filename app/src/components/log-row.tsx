import { memo, MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { containerColor } from '@/lib/log-line';
import { ViewLine } from '@/lib/log-view';
import { StructuredLog } from '@/lib/structured-log';
import { cn } from '@/lib/utils';
import { AnsiText } from '@/components/ansi-text';

const LEVEL_CLASS = { error: 'text-error', warn: 'text-warning' } as const;

/** The message, then (closed) the other fields, faint, on one line. */
function Summary({ log, fields }: { log: StructuredLog; fields: boolean }) {
  return (
    <>
      {log.message && <span>{log.message}</span>}
      {fields &&
        log.fields.map(([key, value]) => (
          <span key={key} className='ml-3 text-muted-foreground'>
            {key}={value}
          </span>
        ))}
    </>
  );
}

/**
 * One log line. Colour comes from the severity the line states, not from the
 * stream: plenty of healthy software logs everything to stderr. stderr is
 * marked quietly in the gutter instead.
 *
 * A JSON line shows a summary and opens to every field; clicking it (unless
 * that click was selecting text) or its chevron toggles it.
 *
 * Memoised on the line object, which the log buffer never recreates, and
 * keyed by its ID, so a flush renders only the new rows.
 */
export const LogRow = memo(function LogRow({
  line,
  container,
  expanded = false,
  onToggle,
}: {
  line: ViewLine;
  container?: string;
  expanded?: boolean;
  onToggle?: (id: number) => void;
}) {
  const log = line.structured;
  const toggle = log && onToggle ? () => onToggle(line.id) : undefined;
  const onClick = (e: MouseEvent) => {
    if (!toggle || window.getSelection()?.toString()) return;
    if ((e.target as HTMLElement).closest('a, button')) return;
    toggle();
  };

  return (
    <div
      data-stream={line.stream}
      data-level={line.level ?? undefined}
      onClick={toggle && onClick}
      className={cn(
        'border-l-2 pl-2',
        log && !expanded ? 'truncate' : 'break-all whitespace-pre-wrap',
        toggle && 'cursor-pointer',
        line.stream === 'stderr' ? 'border-muted-foreground/30' : 'border-transparent',
        line.level && LEVEL_CLASS[line.level],
      )}
    >
      {line.time && (
        <span className='mr-3 text-muted-foreground/80 select-none' title={line.timeFull} data-ts={line.ts ?? undefined}>
          {line.time}
        </span>
      )}
      {container && (
        <span className='mr-3 select-none' style={{ color: containerColor(container) }}>
          {container}
        </span>
      )}
      {toggle && (
        <button
          type='button'
          aria-label={expanded ? 'Hide fields' : 'Show fields'}
          aria-expanded={expanded}
          onClick={toggle}
          className='mr-1 inline-flex align-[-2px] text-muted-foreground hover:text-foreground'
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
      )}
      {log ? <Summary log={log} fields={!expanded} /> : <AnsiText text={line.text} />}
      {log && expanded && (
        <pre className='mt-1 mb-2 ml-1 border-l pl-3 font-mono whitespace-pre-wrap text-foreground'>
          {JSON.stringify(log.object, null, 2)}
        </pre>
      )}
    </div>
  );
});
