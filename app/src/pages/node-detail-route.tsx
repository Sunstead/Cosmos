import { getRouteApi } from '@tanstack/react-router';
import { NodeDetailPage } from './node-detail-page';

const route = getRouteApi('/nodes/$nodeId');

export function NodeDetailRoute() {
  const { nodeId } = route.useParams();
  return <NodeDetailPage nodeId={nodeId} />;
}
