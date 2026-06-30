import { cn } from '@/lib/utils';

export type DotVariant = 'success' | 'warning' | 'error' | 'disabled';

export function Dot({ variant = 'disabled' }: { variant?: DotVariant }) {
  const classes = (() => {
    switch (variant) {
      case 'success':
        return 'bg-success';
      case 'warning':
        return 'bg-warning';
      case 'error':
        return 'bg-error';
      case 'disabled':
        return 'bg-muted-foreground/25';
    }
  })();
  return <div className={cn('size-2 rounded-full', classes)} />;
}
