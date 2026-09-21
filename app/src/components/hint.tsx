import { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { chordKeys, SHORTCUTS, ShortcutId } from '@/lib/shortcuts';

/** Key caps for a registered shortcut. */
export function ShortcutKeys({ id, className }: { id: ShortcutId; className?: string }) {
  return (
    <KbdGroup className={className}>
      {chordKeys(SHORTCUTS[id]).map((k) => (
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
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className='flex items-center gap-2'>
        {label}
        {shortcut && <ShortcutKeys id={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}
