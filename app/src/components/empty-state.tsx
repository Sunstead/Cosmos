import { ReactNode } from 'react';
import { LucideIcon, Plus, ServerOff } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { SetupHint, SetupInfo } from './setup-hint';

type Size = 'page' | 'card' | 'inline';

const SIZE: Record<Size, string> = {
  page: 'min-h-72 border',
  card: 'py-10',
  inline: 'p-4 gap-2',
};

/**
 * The one empty state. `page` fills content space, `card` sits inside a
 * card, `inline` replaces a table body or list.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  setup,
  size = 'card',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Adds a `?` popover with how to enable the thing that's missing. */
  setup?: SetupInfo;
  size?: Size;
  className?: string;
}) {
  return (
    <Empty data-empty-state className={cn(SIZE[size], className)}>
      <EmptyHeader>
        {size !== 'inline' && (
          <EmptyMedia variant='icon'>
            <Icon />
          </EmptyMedia>
        )}
        <EmptyTitle className='flex items-center gap-1 text-sm'>
          {title}
          {setup && <SetupHint info={setup} />}
        </EmptyTitle>
        {description && <EmptyDescription className='text-xs'>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function AddNodeButton({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const setOpen = useUiStore((s) => s.setAddNodeOpen);
  return (
    <Button variant={variant} onClick={() => setOpen(true)}>
      <Plus />
      Add node
    </Button>
  );
}

/** Shown on every page until the first node is added. */
export function NoNodesState() {
  return (
    <EmptyState
      size='page'
      icon={ServerOff}
      title='No nodes yet'
      description='Connect a machine running cosmos-agent.'
      action={<AddNodeButton />}
    />
  );
}
