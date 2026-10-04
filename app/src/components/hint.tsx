import { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sunstead/ui/components/tooltip';
import { Kbd, KbdGroup } from '@sunstead/ui/components/kbd';
import { chordKeys, isSequence, SHORTCUTS, ShortcutId } from '@/lib/shortcuts';

/** Key caps for a registered shortcut: `⌘ K`, or `G then O` for a sequence. */
export function ShortcutKeys({ id, className }: { id: ShortcutId; className?: string }) {
  const chord = SHORTCUTS[id];
  const keys = chordKeys(chord);
  if (isSequence(chord)) {
    return (
      <KbdGroup className={className} aria-label={keys.join(' then ')}>
        {keys.map((k, i) => (
          <span key={i} className='contents'>
            {i > 0 && (
              <span aria-hidden='true' className='text-2xs opacity-60'>
                then
              </span>
            )}
            <Kbd aria-hidden='true'>{k}</Kbd>
          </span>
        ))}
      </KbdGroup>
    );
  }
  return (
    <KbdGroup className={className}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** Tooltip for an icon-only control, with its shortcut when it has one. */
export function Hint({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: string;
  shortcut?: ShortcutId;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className='flex items-center gap-2'>
        {label}
        {shortcut && <ShortcutKeys id={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}
