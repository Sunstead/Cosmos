import { useSearch } from '@tanstack/react-router';
import { useNodeStore } from '@/stores/nodes';
import { PageHeader } from '@/components/page-header';
import { NoNodesState } from '@/components/empty-state';
import { Constellation } from '@/components/constellation';

/**
 * The constellation edge to edge in the content area (`bleed` layout), a
 * window into space: no header, no border. The heading is there for screen
 * readers only.
 */
export function ConstellationPage() {
  const hasNodes = useNodeStore((s) => s.nodes.length > 0);
  const { node } = useSearch({ from: '/constellation' });

  if (!hasNodes) {
    return (
      <div className='flex flex-col gap-4 p-4'>
        <PageHeader title='Constellation' />
        <NoNodesState />
      </div>
    );
  }

  return (
    <>
      <h1 className='sr-only'>Constellation</h1>
      <Constellation variant='full' initialNode={node} className='min-h-0 flex-1' />
    </>
  );
}
