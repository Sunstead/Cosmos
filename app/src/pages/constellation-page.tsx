import { useSearch } from '@tanstack/react-router';
import { useNodeStore } from '@/stores/nodes';
import { PageHeader } from '@/components/page-header';
import { NoNodesState } from '@/components/empty-state';
import { Constellation } from '@/components/constellation';

/** The constellation filling the page. Reached from the Overview card, the palette and G then X. */
export function ConstellationPage() {
  const hasNodes = useNodeStore((s) => s.nodes.length > 0);
  const { node } = useSearch({ from: '/constellation' });

  return (
    <>
      <PageHeader title='Constellation' />
      {hasNodes ? (
        <Constellation variant='full' initialNode={node} className='min-h-0 flex-1 rounded-xl border' />
      ) : (
        <NoNodesState />
      )}
    </>
  );
}
