import { lazy, Suspense, useCallback, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Orbit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { useConstellationSource } from '@/hooks/use-constellation-source';
import { serviceHref } from '@/lib/agent-url';
import { openExternal } from '@/lib/open-external';
import { hasWebGL } from '@/lib/constellation/webgl';
import type { Body } from '@/lib/constellation/model';
import { cn } from '@/lib/utils';

// three.js is its own chunk, loaded only where the constellation is shown.
const ConstellationView = lazy(() => import('./constellation-view').then((m) => ({ default: m.ConstellationView })));

/**
 * The cluster as a 3D hologram: nodes as planets, services as their moons,
 * tailnet devices on an outer ring. A card on the Overview, or the whole
 * `/constellation` page.
 */
export function Constellation({
  variant = 'card',
  className,
  initialNode,
}: {
  variant?: 'card' | 'full';
  className?: string;
  /** A node id to start focused on. */
  initialNode?: string | null;
}) {
  const [supported, setSupported] = useState(hasWebGL);
  const source = useConstellationSource();
  const navigate = useNavigate();

  const open = useCallback(
    (body: Body) => {
      if (body.kind === 'node') void navigate({ to: '/nodes/$nodeId', params: { nodeId: body.id } });
      else if (body.kind === 'probe') void navigate({ to: '/network' });
      else {
        const href = serviceHref(body.url);
        if (href) void openExternal(href);
        else void navigate({ to: '/services' });
      }
    },
    [navigate],
  );
  const expand = useCallback(
    (node: string | null) => void navigate({ to: '/constellation', search: node ? { node } : {} }),
    [navigate],
  );
  const unsupported = useCallback(() => setSupported(false), []);

  if (!supported) {
    return (
      <div className={cn('grid place-items-center', className)}>
        <EmptyState
          size='inline'
          icon={Orbit}
          title='The 3D view needs WebGL'
          description='This browser has it turned off or unavailable. Your nodes are all on the Nodes page.'
          action={
            <Button variant='outline' size='sm' asChild>
              <Link to='/nodes'>Show nodes</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <Suspense fallback={<div className={cn('bg-[var(--holo-space)]', className)} />}>
      <ConstellationView
        source={source}
        variant={variant}
        className={className}
        initialNode={initialNode}
        onOpen={open}
        onExpand={variant === 'card' ? expand : undefined}
        onUnsupported={unsupported}
      />
    </Suspense>
  );
}
