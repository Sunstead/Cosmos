import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { useNodeName } from '@/stores/nodes';

/** A node's display name, linking to its detail page. */
export const NodeName = memo(function NodeName({ nodeId }: { nodeId: string }) {
  const name = useNodeName(nodeId);
  return (
    <Link
      to='/nodes/$nodeId'
      params={{ nodeId }}
      className='truncate text-muted-foreground hover:text-foreground hover:underline'
    >
      {name ?? nodeId}
    </Link>
  );
});
