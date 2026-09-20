import { ReactNode } from 'react';
import { LucideIcon, ServerOff, Settings2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Button } from './ui/button';

/** Shown when no node has been added yet. */
export function NoNodes({ what }: { what: string }) {
  return (
    <Empty className='border rounded-xl'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <ServerOff />
        </EmptyMedia>
        <EmptyTitle>No nodes yet</EmptyTitle>
        <EmptyDescription>
          Add a node running <code>cosmos-agent</code> to see {what}.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link to='/nodes'>Go to Nodes</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * Shown when every connected node has the feature switched off.
 *
 * Distinct from "no data": the agent answered 501, so the fix is a config
 * change on the node, not waiting.
 */
export function FeatureDisabled({
  title,
  description,
  icon: Icon = Settings2,
}: {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Empty className='border rounded-xl'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Generic "nothing here" for a page whose nodes are connected but empty. */
export function NothingHere({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <Empty className='border rounded-xl'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
