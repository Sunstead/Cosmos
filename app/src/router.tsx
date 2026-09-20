import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  Outlet,
  redirect,
  createBrowserHistory,
} from '@tanstack/react-router';
import { AppLayout } from './layouts/AppLayout';
import OverviewPage from './pages/overview-page';
import { NodesPage } from './pages/nodes-page';
import { NodeDetailPage } from './pages/node-detail-page';
import { ServicesPage } from './pages/services-page';
import { VolumesPage } from './pages/volumes-page';
import { NetworkPage } from './pages/network-page';
import { MonitoringPage } from './pages/monitoring-page';
import { LogsPage } from './pages/logs-page';
import { BackupsPage } from './pages/backups-page';
import { SettingsPage } from './pages/settings-page';
import { ContainersPage } from './pages/containers-page';
import { useNodeStore } from './stores/nodes';
import { getDefaultNodes } from './config';
import { isTauri } from './lib/tauri';

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const store = useNodeStore.getState();
    if (store.nodes.length > 0) return;

    // Seeded in parallel: the previous sequential loop blocked first paint on
    // one round trip per configured node.
    const defaults = await getDefaultNodes();
    await Promise.allSettled(defaults.map((n) => store.addNode(n.url, n.token)));
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});

// Defined one by one rather than through a helper: TanStack Router infers the
// literal path types from these calls, and a wrapper function erases them.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/overview' });
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overview',
  component: OverviewPage,
});

const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes',
  component: NodesPage,
});

/** Reached from the Details button on a node card or row. */
const nodeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes/$nodeId',
  component: function NodeDetailRoute() {
    const { nodeId } = nodeDetailRoute.useParams();
    return <NodeDetailPage nodeId={nodeId} />;
  },
});

const servicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services',
  component: ServicesPage,
});

const containersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/containers',
  component: ContainersPage,
});

const volumesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/volumes',
  component: VolumesPage,
});

const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  component: NetworkPage,
});

const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitoring',
  component: MonitoringPage,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsPage,
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backups',
  component: BackupsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  overviewRoute,
  nodesRoute,
  nodeDetailRoute,
  servicesRoute,
  containersRoute,
  volumesRoute,
  networkRoute,
  monitoringRoute,
  logsRoute,
  backupsRoute,
  settingsRoute,
]);

// Hash history under Tauri: the custom protocol doesn't serve arbitrary paths.
const history = isTauri() ? createHashHistory() : createBrowserHistory();

export const router = createRouter({ routeTree, history });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
