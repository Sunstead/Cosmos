import { LucideIcon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@sunstead/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@sunstead/ui/components/tooltip';

export interface SegmentOption<T extends string> {
  value: T;
  label?: string;
  icon?: LucideIcon;
  /** Tooltip, required when the option is icon-only. */
  hint?: string;
}

/** Single-choice segmented control. Always has a value selected. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  /** Accessible name for the group. */
  label: string;
}) {
  return (
    <ToggleGroup
      variant='outline'
      spacing={0}
      value={[value]}
      // Pressing the active item again empties the group; a segmented control
      // always has one, so that change is ignored.
      onValueChange={(v) => v[0] && onChange(v[0] as T)}
      aria-label={label}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const item = (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            aria-label={o.hint ?? o.label}
            className='text-xs data-pressed:bg-muted data-pressed:text-foreground'
          >
            {Icon && <Icon />}
            {o.label}
          </ToggleGroupItem>
        );
        if (!o.hint) return item;
        return (
          <Tooltip key={o.value}>
            <TooltipTrigger render={item} />
            <TooltipContent>{o.hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}
