import { memo } from 'react';
import { LogLine } from '@/generated/LogLine';
import { containerColor, formatLogTime, formatLogTimeFull, logLevel } from '@/lib/log-line';
import { cn } from '@/lib/utils';
import { AnsiText } from '@/components/ansi-text';

const LEVEL_CLASS = { error: 'text-error', warn: 'text-warning' } as const;

/**
 * One log line. Colour comes from the severity the line states, not from the
 * stream: plenty of healthy software logs everything to stderr. stderr is
 * marked quietly in the gutter instead.
 *
 * Memoised on the line object, which the log buffer never recreates, so a
 * flush re-renders only the new rows.
 */
export const LogRow = memo(function LogRow({ line, container }: { line: LogLine; container?: string }) {
  const level = logLevel(line.text);
  const time = formatLogTime(line.ts);
  return (
    <div
      data-stream={line.stream}
      data-level={level ?? undefined}
      className={cn(
        'border-l-2 pl-2 break-all whitespace-pre-wrap',
        line.stream === 'stderr' ? 'border-muted-foreground/30' : 'border-transparent',
        level && LEVEL_CLASS[level],
      )}
    >
      {time && (
        <span
          className='mr-3 text-muted-foreground/60 select-none'
          title={formatLogTimeFull(line.ts)}
          data-ts={line.ts ?? undefined}
        >
          {time}
        </span>
      )}
      {container && (
        <span className='mr-3 select-none' style={{ color: containerColor(container) }}>
          {container}
        </span>
      )}
      <AnsiText text={line.text} />
    </div>
  );
});
