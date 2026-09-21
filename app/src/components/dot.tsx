import { cn } from '@/lib/utils';

export type DotVariant = 'success' | 'warning' | 'error' | 'disabled';

const VARIANTS: Record<DotVariant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  disabled: 'bg-muted-foreground/25',
};

export function Dot({
  variant = 'disabled',
  title,
  pulse,
  className,
}: {
  variant?: DotVariant;
  /** Native tooltip, used to name the container a dot represents. */
  title?: string;
  /** Soft glow for something live. */
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        VARIANTS[variant],
        pulse && variant === 'success' && 'shadow-[0_0_6px_var(--color-success)]',
        className,
      )}
    />
  );
}
