import { LucideIcon } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
      type='single'
      variant='outline'
      spacing={0}
      value={value}
      // Radix allows deselecting the active item; a segmented control can't.
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const item = (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            aria-label={o.hint ?? o.label}
            className='text-xs data-[state=on]:text-foreground'
          >
            {Icon && <Icon />}
            {o.label}
          </ToggleGroupItem>
        );
        if (!o.hint) return item;
        return (
          <Tooltip key={o.value}>
            <TooltipTrigger asChild>{item}</TooltipTrigger>
            <TooltipContent>{o.hint}</TooltipContent>
          </Tooltip>
        );
      })}
    </ToggleGroup>
  );
}
