import {
  lazyRouteComponent,
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  Outlet,
  redirect,
  createBrowserHistory,
} from '@tanstack/react-router';
import { AppLayout } from './layouts/AppLayout';
import { useNodeStore } from './stores/nodes';
import { useUiStore } from './stores/ui';
import { getDefaultNodes } from './config';
import { isDesktop } from './lib/platform';

export interface LogsSearch {
  node?: string;
  container?: string;
}

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const store = useNodeStore.getState();
    if (store.nodes.length > 0) return;

    const defaults = await getDefaultNodes();
    const results = await Promise.all(defaults.map((n) => store.addNode(n.url, n.token)));
    // A configured node that wants a token: ask for it with the address filled in.
    const locked = defaults.find((_, i) => {
      const r = results[i];
      return !r.ok && r.error === 'This agent requires a token.';
    });
    if (locked) useUiStore.getState().setAddNodeOpen(true, locked.url);
  },
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
});

// Defined individually: a helper function would erase the router's literal
// path types. Pages are lazy so heavy dependencies (recharts) load on demand.
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
  component: lazyRouteComponent(() => import('./pages/overview-page'), 'OverviewPage'),
});

const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes',
  component: lazyRouteComponent(() => import('./pages/nodes-page'), 'NodesPage'),
});

/** Reached from the Details button on a node card or row. */
const nodeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes/$nodeId',
  component: lazyRouteComponent(() => import('./pages/node-detail-route'), 'NodeDetailRoute'),
});

const servicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services',
  component: lazyRouteComponent(() => import('./pages/services-page'), 'ServicesPage'),
});

const containersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/containers',
  component: lazyRouteComponent(() => import('./pages/containers-page'), 'ContainersPage'),
});

const volumesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/volumes',
  component: lazyRouteComponent(() => import('./pages/volumes-page'), 'VolumesPage'),
});

const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  component: lazyRouteComponent(() => import('./pages/network-page'), 'NetworkPage'),
});

const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitoring',
  component: lazyRouteComponent(() => import('./pages/monitoring-page'), 'MonitoringPage'),
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  staticData: { layout: 'fill' },
  validateSearch: (s: Record<string, unknown>): LogsSearch => ({
    node: typeof s.node === 'string' ? s.node : undefined,
    container: typeof s.container === 'string' ? s.container : undefined,
  }),
  component: lazyRouteComponent(() => import('./pages/logs-page'), 'LogsPage'),
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backups',
  component: lazyRouteComponent(() => import('./pages/backups-page'), 'BackupsPage'),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./pages/settings-page'), 'SettingsPage'),
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
const history = isDesktop() ? createHashHistory() : createBrowserHistory();

export const router = createRouter({ routeTree, history });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
